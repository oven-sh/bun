// The `..` and the name in part stand in two arguments of `path.join`: that was no name at all to the build, and the files were not in the executable.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "node:path";
const name = process.argv.length > 9 ? process.argv[9] : "second";
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    if (worker.on) worker.on("message", end).on("error", () => end("error"));
    else [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("joined", new Worker(path.join(import.meta.dir, "../../jobs", name + ".js")));
