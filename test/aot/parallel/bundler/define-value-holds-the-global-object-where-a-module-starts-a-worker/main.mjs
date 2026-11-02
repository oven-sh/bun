// A module holds the global object in a variable and starts a Worker where a `--define` puts the name of the variable in front of `.Worker`. Only this file spells the constructor. The build compiles the file that the Worker starts from.
// Flags: --define G=g
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { worker } from "./start.mjs";
console.log(worker instanceof Worker);
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
