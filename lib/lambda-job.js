// LambdaJob 1.0.0 by Larry Gadea (trivex@gmail.com)

function LambdaJobClient(options) {
	var s3 = new AWS.S3();

	// Default options
	if (options == undefined) options = {}
	var defaults = {
		debugLog: false,
		maxActiveJobs: 25,
		jobTimeout: 30000,
		s3BucketPrefix: "lambda-job-",
	}
	Object.keys(defaults).forEach(function(key) {
		options[key] = (options[key] == undefined) ? defaults[key] : options[key]
	});

	function debugInfo(text) {
		if (options.debugLog)
			console.log(text);
	}

	function debugError(text) {
		if (options.debugLog)
			console.error(text)
	}

	function getRandomId() {
		return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	}

	this.invoke = function(lambdaName, lambdaParams, errDataCallback) {
		var iid = getRandomId();
		debugInfo("Will be invoking " + lambdaName + " (" + iid + ")");

		var jobInfo = {iid: iid, lambdaName: lambdaName, params: lambdaParams, errDataCallback: errDataCallback};
		debugInfo("Invoking " + jobInfo.lambdaName + " (" + jobInfo.iid + ")" );

		s3.putObject({Bucket: options.s3BucketPrefix + jobInfo.lambdaName, Key: jobInfo.iid + "-request.job", Body: JSON.stringify(jobInfo)}, function(err, data) {
			if (err) {
				processJobResponse(jobInfo, "Failed to create S3 job: " + err, null);
				return;
			}
		});
		debugInfo("Finished sending S3 job");
	}
}

/////////////////////////////

var LambdaJobWorker = function(AWS, jobReceivedCallback) {
	var util = require('util');
	var jobInfo = null;

	this.lambdaHandler = function(event, context) {
		console.log("LambdaJob 1.0.0 by Larry Gadea (trivex@gmail.com)");

		// Check this is a valid job that we can process and get the id. Since this lambda will
		// get called on ANY new objects in a bucket, it's possible the bucket is actually
		// multi-purpose and we should ignore the job
		var bucket, key, id;
		try {
			bucket = event.Records[0].s3.bucket.name;
			key = event.Records[0].s3.object.key;
			id = key.match(/(.+)\-request\.job/)[1];
		} catch (e) {
			return console.error("Couldn't identify event as a LambdaJob: " + util.inspect(event, {showHidden: false, depth: null}));
		}
		console.log("Processing LambdaJob: " + id);

		// Though we have the ID, we need to get the actual job data from S3
		var s3 = new AWS.S3();
		s3.getObject({Bucket: bucket, Key: key}, function(err, data) {
			if (err) return console.error("Failed to download job object: " + util.inspect(err, {showHidden: false, depth: null}));
			jobInfo = JSON.parse(data.Body.toString());
			var queueUrl = jobInfo.queueUrl;

			// Call the user code with the job data. This is where the user would run things
			// like phantomjs, ffmpeg, imagemagick, etc.
			jobReceivedCallback(jobInfo.params, finishJob);
		});

		s3.deleteObject({Bucket: bucket, Key: key}, function(err, data) {});
		console.log("Removed job (" + key + ") from S3 ");
	}

	function finishJob(err, data) {
		console.log("Job has finished " + (err ? "with an error" : "successfully") + ": " + util.inspect(err || data, {showHidden: false, depth: null}));
	}

	// Helper for bash example
	this.execHelper = function(cmd, errDataCallback) {
		var cp = require('child_process');

		var output = "";
		console.log("Running command: " + cmd);
		var process = cp.spawn('bash', ['-c', cmd], {});

		process.stdout.on('data', function (data) {
			console.log("> " + data.toString());
			output += data.toString();
		});
		process.stderr.on('data', function (data) {
			console.log("! " + data.toString());
			output += data.toString();
		});
		process.on('close', function (code) {
			if (code != 0) {
				errDataCallback("Process returned code: " + code, output);
			} else {
				errDataCallback(null, output);
			}
		});
	}
}

// To make this module not cause errors for the web browser
if (typeof module !== 'undefined')
module.exports.LambdaJobWorker = LambdaJobWorker;
