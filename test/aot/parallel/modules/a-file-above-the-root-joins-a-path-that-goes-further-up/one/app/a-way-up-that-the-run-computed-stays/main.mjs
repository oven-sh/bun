// path.relative() makes `../../texts/en.json` of two paths of the executable, and path.join() makes /$bunfs/root/texts/en.json of it again: the file beside the entry point, which is meant. Nothing of that way up is written at the load.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "node:path";
import "./texts/en.json";
import { byWayFromHere } from "../loaders/whatever-is-handed-in.mjs";
console.log(
  (await byWayFromHere(path.join(import.meta.dirname, "texts", process.argv.length > 9 ? process.argv[9] : "en.json")))
    .default.said,
);
