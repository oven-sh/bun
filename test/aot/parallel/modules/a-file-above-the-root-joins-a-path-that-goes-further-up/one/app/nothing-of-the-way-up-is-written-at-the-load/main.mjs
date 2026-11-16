// The way up is handed in.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "./texts/en.json";
import { whateverIsHandedIn } from "../loaders/further.mjs";
console.log((await whateverIsHandedIn(process.argv.length > 9 ? process.argv[9] : "../../texts/en.json")).default.said);
