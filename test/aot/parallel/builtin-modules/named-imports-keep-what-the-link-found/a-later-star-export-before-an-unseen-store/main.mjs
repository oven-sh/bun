// The entry imports names of node:path and reads nothing, a later file hands the module on by a star, then a text that the build cannot read stores into it: both read what the links found.
import { sep, join } from "node:path";
const star = await import("./star.mjs");
// The text is cut at a number of the run, so the build cannot work it out.
const runUnseen = text => new Function(text.slice(process.argv.length - process.argv.length))();
runUnseen(`const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched";`);
console.log("the entry:", sep, join("a", "b"), "the star:", star.sep, star.join("a", "b"));
