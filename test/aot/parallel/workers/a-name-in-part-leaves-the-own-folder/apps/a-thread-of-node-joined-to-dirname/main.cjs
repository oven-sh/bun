// `__dirname` is the folder of the source, and the thread is one of node:worker_threads.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const path = require("node:path");
const { Worker: Thread } = require("node:worker_threads");
const name = process.argv.length > 9 ? process.argv[9] : "first";
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    if (worker.on) worker.on("message", end).on("error", () => end("error"));
    else [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
report("a thread of node", new Thread(path.join(__dirname, "..", "..", "jobs", name + ".js")));
