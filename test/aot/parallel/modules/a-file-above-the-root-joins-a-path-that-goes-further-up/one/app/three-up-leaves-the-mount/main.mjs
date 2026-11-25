// The loader goes three folders up. texts/ has no fr.json; one/app/texts, one folder above the entry point, has one.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "../texts/en.json";
import "../texts/fr.json";
import { load } from "../loaders/three-up.mjs";
try {
  console.log((await load(process.argv.length > 9 ? process.argv[9] : "fr")).default.said);
} catch (error) {
  console.log(error.name, error.code);
}
