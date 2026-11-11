// A file of the program lies above the entry point. The folder of the entry point listed a `_.._` beside its own files.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import fs from "node:fs";
import "../lib/above.mjs";
import "./beside.mjs";
console.log(
  fs
    .readdirSync(import.meta.dir)
    .sort()
    .join(" "),
);
