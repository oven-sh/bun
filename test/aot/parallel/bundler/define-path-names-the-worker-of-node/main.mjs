// A Worker of node:worker_threads starts from a file beside the program, where a `--define` whose value is `threads.Worker` is the constructor and one whose value is `path.join` makes the path. The build compiles the file, as where the paths are spelled.
// Flags: --define W=threads.Worker --define PJ=path.join
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import * as threads from "node:worker_threads";
import * as path from "node:path";
const worker = new W(PJ(import.meta.dirname, "w.mjs"));
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
