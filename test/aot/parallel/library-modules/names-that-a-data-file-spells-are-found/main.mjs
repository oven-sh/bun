// The names stand written in a data file that the program imports, and reach a made require under an index that nobody reads. What a data file spells as a value is held for a name that is made at run time, as a string in code is.
import { createRequire } from "node:module";
import names from "./names.json";
const load = createRequire(import.meta.url);
const at = JSON.parse("1");
console.log(typeof load(names.list[at]).gzipSync, typeof load(names.deep.one).isatty);
