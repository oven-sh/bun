// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The file that starts itself is no entry point. Its start stands above the load of the module, under a name of the program's own, and is given
// the path of the file. The load takes that for the name of the file, and the Worker starts.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { answer } from "./lib/pool.mjs";
console.log(answer);
