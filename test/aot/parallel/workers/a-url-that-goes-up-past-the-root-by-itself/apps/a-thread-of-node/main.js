// The file of a Worker of node:worker_threads lies two folders above the entry point, and the program names it by a URL object made from its own URL, and in no other way.
// In an executable the URL says /jobs/job.js: `..` has left nothing of /$bunfs/root. The build writes down what that leads to.
// By itself: a joined path to the same file writes the same name down, and beside one the fault did not show.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Worker as Thread } from "node:worker_threads";
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    if (worker.on) worker.on("message", end).on("error", () => end("error"));
    else [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("a thread of node", new Thread(new URL("../../jobs/job.js", import.meta.url)));
