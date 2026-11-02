// A `--define` whose value is one name puts the namespace of node:worker_threads where the file constructs a Worker of it. The build compiles the file that the Worker starts from.
// Flags: --define T=threads
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import * as threads from "node:worker_threads";
const worker = new T.Worker(new URL("./w.mjs", import.meta.url));
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
