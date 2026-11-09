// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The function that joins the path is required below the start, so nothing names the file. The build said nothing and left the file out.
function start() {
  return new Worker(join(__dirname, "no-such-job.js"));
}
const { Worker } = require("node:worker_threads");
const { join } = require("node:path");
if (process.argv.length > 5) start();
console.log("none started");
