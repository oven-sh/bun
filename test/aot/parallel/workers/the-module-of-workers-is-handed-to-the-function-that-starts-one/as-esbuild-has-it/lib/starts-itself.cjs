var threads;
try {
  threads = require("node:worker_threads");
} catch {
  threads = void 0;
}
var startWith = (given, data) => new given.Worker(__filename, { workerData: data });
if (threads.isMainThread) exports.start = () => startWith(threads, { name: "the file itself" });
else threads.parentPort.postMessage("answers from " + threads.workerData.name);
