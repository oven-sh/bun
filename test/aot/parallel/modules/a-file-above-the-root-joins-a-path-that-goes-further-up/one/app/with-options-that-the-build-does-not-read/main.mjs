// The loader lies above the entry point, in /$bunfs/root/_.._/loaders, and goes two folders up: path.join() takes the _.._ away where it should go further up, and /$bunfs/root/texts is left: the folder beside the entry point.
// Nothing that the build has found is held against the text: the loader is asked.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "./texts/en.json";
import "./texts/fr.json";
import { load } from "../loaders/with-options-in-a-variable.mjs";
console.log((await load(process.argv.length > 9 ? process.argv[9] : "en")).default.said);
