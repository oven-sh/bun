// Nothing lies above the entry point: a file in lib/ loads from the folder beside lib/.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { load } from "./lib/loader.js";
console.log((await load(process.argv.length > 9 ? process.argv[9] : "first")).said);
