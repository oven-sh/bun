// The loader lies above the entry point, in one/app/loaders, and goes two folders up, to one/texts. Beside the entry point lies a folder `texts` too. In an executable the files above the folder of the entry point lie in a mount of their own, /$bunfs/_.._, spelled from the top down: a `..` of the run takes a folder away and leads up, as on disk.
// With options the text went to the loader past what the build had found.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "./texts/en.json";
import "./texts/fr.json";
import { load } from "../loaders/with-options.mjs";
console.log((await load(process.argv.length > 9 ? process.argv[9] : "en")).default.said);
