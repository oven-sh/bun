// A variable holds the constructor of Workers, a second variable is initialized with a `--define` whose value is the name of the first, and a Worker starts where the second is constructed. The build compiles the file that the Worker starts from.
// Flags: --define W=Made
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const Made = Worker;
const Copy = W;
const worker = new Copy(new URL("./w.mjs", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
