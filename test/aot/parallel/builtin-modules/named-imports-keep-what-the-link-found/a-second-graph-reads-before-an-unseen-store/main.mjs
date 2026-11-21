// The entry imports names of node:path and reads nothing, a second graph reads the same names, then a text that the build cannot read stores into the module: the entry still reads what its link found.
import { sep, join } from "node:path";
const second = await import("./second.mjs");
// The text is cut at a number of the run, so the build cannot work it out.
const runUnseen = text => new Function(text.slice(process.argv.length - process.argv.length))();
runUnseen(`const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched";`);
console.log("the entry:", sep, join("a", "b"), "the second graph:", second.read());
