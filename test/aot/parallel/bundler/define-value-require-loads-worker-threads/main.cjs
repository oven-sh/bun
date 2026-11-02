// A `--define` whose value is `require` loads node:worker_threads where the defined name is called, and a Worker of that module starts from a file beside the program. The build compiles the file.
// Flags: --define LOAD=require
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const { Worker } = LOAD("node:worker_threads");
const worker = new Worker(__dirname + "/w.cjs");
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
