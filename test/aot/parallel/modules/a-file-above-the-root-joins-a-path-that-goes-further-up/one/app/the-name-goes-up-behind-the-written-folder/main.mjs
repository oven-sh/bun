// The part of the name that the build does not know leaves the folder that is written.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "./texts/en.json";
import "./others/en.json";
import { belowTheWrittenFolder } from "../loaders/further.mjs";
console.log((await belowTheWrittenFolder(process.argv.length > 9 ? process.argv[9] : "../others/en")).default.said);
