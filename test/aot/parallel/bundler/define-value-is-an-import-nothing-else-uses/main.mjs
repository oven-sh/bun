// A `--define` whose value is one name reads the import of that name, which nothing else in the module uses.
// Flags: --define NAME=named
import { named } from "./exports.mjs";
console.log(NAME);
