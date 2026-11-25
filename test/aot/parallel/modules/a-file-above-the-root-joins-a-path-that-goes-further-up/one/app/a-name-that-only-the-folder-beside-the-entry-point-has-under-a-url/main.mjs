// As beside, by `new URL()`: file:///$bunfs/root/texts/fr.json is left.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "./texts/en.json";
import "./texts/fr.json";
import { load } from "../loaders/under-a-url.mjs";
try {
  console.log((await load(process.argv.length > 9 ? process.argv[9] : "fr")).default.said);
} catch (error) {
  console.log(error.name, error.code);
}
