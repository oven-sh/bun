// The file that starts the Worker lies above the entry point. Where it lies in the executable hangs on the highest file of the program: the build puts the code together when it knows that, and compiles it.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { startFromDataUrl } from "../lib/starts.mjs";
console.log(await startFromDataUrl());
