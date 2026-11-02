// A `--define` whose value names the variable that holds what `createRequire` made calls it: the build finds the file that the call loads.
// Flags: --define REQ=made
import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
console.log(REQ("./lib.cjs").name);
