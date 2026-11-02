// A `--define` whose value is the path `mod.createRequire` makes a `require` where the defined name is called, as `mod.createRequire(..)` does: the build finds the file that it loads.
// Flags: --define CR=mod.createRequire
import * as mod from "node:module";
const req = CR(import.meta.url);
console.log(req("./lib.cjs").name);
