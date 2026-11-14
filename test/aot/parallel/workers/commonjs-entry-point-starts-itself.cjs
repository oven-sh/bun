// require.main is the entry point in a worker that runs it, too.
const { isMainThread, parentPort, Worker } = require("node:worker_threads");

const answer = [require.main === module, module.parent === null].join();
if (isMainThread) {
  const worker = new Worker(__filename);
  worker.once("message", message => {
    console.log("main thread:", answer, "worker:", message);
    worker.terminate();
  });
} else {
  parentPort.postMessage(answer);
}
