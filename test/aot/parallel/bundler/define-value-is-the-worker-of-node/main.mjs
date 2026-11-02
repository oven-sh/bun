// A `--define` whose value is `Worker`, which the file imports from node:worker_threads, starts a Worker where the defined name is constructed. The build compiles the file that the Worker starts from.
// Flags: --define W=Worker
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Worker } from "node:worker_threads";
const worker = new W(new URL("./w.mjs", import.meta.url));
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
