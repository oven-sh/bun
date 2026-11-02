// A variable holds the global object, and a `--define` puts the name of the variable in front of `.URL` where the URL of a Worker's file is made. The build compiles the file that the Worker starts from.
// Flags: --define G=g
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const g = globalThis;
const worker = new Worker(new G.URL("./w.mjs", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
