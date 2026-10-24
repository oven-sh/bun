// Built ins found by binding: programs worker members. It prints what plain Bun prints.
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const describe = () => [typeof process._debugEnd, typeof process._debugProcess, typeof process._startProfilerIdleNotifier, typeof process._stopProfilerIdleNotifier, typeof process.on, typeof process.abort].join();
if (isMainThread) {
  console.log("main", describe());
  new Worker(__filename).on("message", text => console.log("worker", text));
} else {
  parentPort.postMessage(describe());
}
