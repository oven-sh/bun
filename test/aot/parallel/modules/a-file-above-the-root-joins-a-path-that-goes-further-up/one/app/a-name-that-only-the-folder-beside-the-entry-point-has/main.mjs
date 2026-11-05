// The loader lies above the entry point, in /$bunfs/root/_.._/loaders, and goes two folders up: path.join() takes the _.._ away where it should go further up, and /$bunfs/root/texts is left: the folder beside the entry point.
// one/texts has no fr.json: `bun main.mjs` finds nothing.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "./texts/en.json";
import "./texts/fr.json";
import { load } from "../loaders/joined.mjs";
try {
  console.log((await load(process.argv.length > 9 ? process.argv[9] : "fr")).default.said);
} catch (error) {
  console.log(error.name, error.code);
}
