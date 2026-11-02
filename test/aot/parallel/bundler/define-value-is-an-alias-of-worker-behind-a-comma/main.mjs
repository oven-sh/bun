// A variable holds the constructor of Workers, and a `--define` whose value is the name of the variable is constructed behind a comma where a Worker starts. The build compiles the file that the Worker starts from.
// Flags: --define W=Made
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const Made = Worker;
const worker = new (0, W)(new URL("./w.mjs", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
