// A `--define` whose value is `createRequire` makes a `require` where the defined name is called: the build finds the file that it loads.
// Flags: --define CR=createRequire
import { createRequire } from "node:module";
const made = CR(import.meta.url);
console.log(made("./lib.cjs").name);
