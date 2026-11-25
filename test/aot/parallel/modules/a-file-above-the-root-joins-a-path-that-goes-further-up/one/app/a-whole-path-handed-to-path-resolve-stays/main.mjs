// path.resolve() answers with the whole path that it is handed: /$bunfs/root/texts/en.json is the file beside the entry point, which is meant.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "node:path";
import "./texts/en.json";
import { resolved } from "../loaders/whatever-is-handed-in.mjs";
console.log(
  (await resolved(path.join(import.meta.dirname, "texts", process.argv.length > 9 ? process.argv[9] : "en.json")))
    .default.said,
);
