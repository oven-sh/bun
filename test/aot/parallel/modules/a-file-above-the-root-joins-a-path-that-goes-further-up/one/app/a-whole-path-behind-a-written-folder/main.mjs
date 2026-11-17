// path.resolve() answers with the whole path that it is handed, whatever folder is written in front of it: the file beside the entry point is meant, and one/texts has no file of that name.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "./texts/fr.json";
import { resolvedBelowTheWrittenFolder } from "../loaders/further.mjs";
import path from "node:path";
console.log(
  (
    await resolvedBelowTheWrittenFolder(
      path.join(import.meta.dirname, "texts", process.argv.length > 9 ? process.argv[9] : "fr.json"),
    )
  ).default.said,
);
