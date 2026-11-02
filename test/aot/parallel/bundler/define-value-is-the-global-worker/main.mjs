// A `--define` whose value is `Worker`, which no file declares, starts a Worker of the global constructor where the defined name is constructed. The build compiles the file that the Worker starts from.
// Flags: --define W=Worker
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const worker = new W(new URL("./w.mjs", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
