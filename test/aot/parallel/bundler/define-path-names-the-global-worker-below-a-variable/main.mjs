// A variable holds the global object, and a `--define` whose value is the path from the variable to the constructor of Workers starts a Worker where the defined name is constructed. The file spells the constructor in another place too. The build compiles the file that the Worker starts from.
// Flags: --define W=g.Worker
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const g = globalThis;
const worker = new W(new URL("./w.mjs", import.meta.url));
console.log(worker instanceof Worker);
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
