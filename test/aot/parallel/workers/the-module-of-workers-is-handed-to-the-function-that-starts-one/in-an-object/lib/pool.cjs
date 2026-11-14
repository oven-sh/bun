const path = require("node:path");
const threads = require("node:worker_threads");
const startWith = options => new options.threads.Worker(path.join(__dirname, "job.cjs"));
exports.start = () => startWith({ threads });
