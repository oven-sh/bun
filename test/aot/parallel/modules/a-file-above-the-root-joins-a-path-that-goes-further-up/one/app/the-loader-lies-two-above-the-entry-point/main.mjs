// The loader lies in /$bunfs/root/_.._/_.._ and goes one up: /$bunfs/root/_.._/texts is left, which is one/app/texts. texts/ has no fr.json.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "../texts/en.json";
import "../texts/fr.json";
import { load } from "../../two-above-the-entry-point.mjs";
try {
  console.log((await load(process.argv.length > 9 ? process.argv[9] : "fr")).default.said);
} catch (error) {
  console.log(error.name, error.code);
}
