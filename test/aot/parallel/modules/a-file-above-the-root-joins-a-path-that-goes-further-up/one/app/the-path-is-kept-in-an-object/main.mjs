// The build does not follow the text from where it is made to where it is loaded: the loader is asked for what path.join() has made.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "./texts/en.json";
import { keptInAnObject } from "../loaders/further.mjs";
console.log((await keptInAnObject(process.argv.length > 9 ? process.argv[9] : "en")).default.said);
