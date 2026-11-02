// A function starts a Worker from its parameter, and a `--define` puts the name of the parameter where the Worker starts. The build compiles the file that the call names.
// Flags: --define ENTRY=entry
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function spawn(entry) {
  return new Worker(ENTRY);
}
const worker = spawn(new URL("./w.mjs", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
