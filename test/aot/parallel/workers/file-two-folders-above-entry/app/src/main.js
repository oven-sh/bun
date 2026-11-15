// The file of a Worker lies two folders above the entry point, and the program names it from its own URL and folder.
// Alone: beside other entry points the root of the executable lies above all of these files
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./lib/start.js";
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end(event.data);
    worker.onerror = event => (event.preventDefault(), end("error"));
  });
const url = new URL("../../jobs/job.js", import.meta.url);
await report("a URL", new Worker(new URL("../../jobs/job.js", import.meta.url)));
await report("a URL in a const", new Worker(url));
await report("its href", new Worker(url.href));
await report("its path", new Worker(fileURLToPath(url)));
await report("a joined path", new Worker(path.join(import.meta.dir, "../../jobs/job.js")));
await report("a resolved path", new Worker(path.resolve(import.meta.dirname, "..", "..", "jobs", "job.js")));
await report("no extension", new Worker(path.join(import.meta.dir, "../../jobs/job")));
await report("from a folder below", start());
await report("not there", new Worker(new URL("../../jobs/not-there.js", import.meta.url)));
