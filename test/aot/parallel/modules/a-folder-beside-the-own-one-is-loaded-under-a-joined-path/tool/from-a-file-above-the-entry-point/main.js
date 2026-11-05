// The file that loads lies above the entry point itself: its folder is /$bunfs/root/_.._/shared, and what it joins is the path of the module, which nothing held it against.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { load } from "../shared/loader.js";
console.log((await load(process.argv.length > 9 ? process.argv[9] : "second")).said);
