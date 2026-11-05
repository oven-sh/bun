// Three folders up from /$bunfs/root/_.._/loaders is /$bunfs, and /$bunfs/texts is what a file IN the root leaves that goes one up: one/app/texts. texts/ has no fr.json.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "../texts/en.json";
import "../texts/fr.json";
import { load } from "../loaders/three-up.mjs";
try {
  console.log((await load(process.argv.length > 9 ? process.argv[9] : "fr")).default.said);
} catch (error) {
  console.log(error.name, error.code);
}
