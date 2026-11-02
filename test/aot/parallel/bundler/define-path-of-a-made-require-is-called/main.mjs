// `createRequire` makes a `require` for the file, and the build finds the files that its `resolve` and its `call` name where the text spells them. It stops where a `--define` writes such a path in front of the arguments.
// Flags: --define RES=made.resolve --define C=made.call
import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
console.log(made(RES("./lib.cjs")).name);
console.log(C(null, "./lib.cjs").name);
/* Plain Bun prints:
lib
lib
*/
/* Build errors:
error: TS100050: --aot does not support --define RES=made.resolve where RES is called
error: TS100050: --aot does not support --define C=made.call where C is called
*/
