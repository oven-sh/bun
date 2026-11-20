// One file imports node:path by names, as a namespace and by default, and reads the namespace first; then a text that the build cannot read stores into the module: names and namespace keep what the link found.
import { sep, join } from "node:path";
import * as names from "node:path";
import path from "node:path";
const before = names.sep + " " + names.join("a", "b");
// The text is cut at a number of the run, so the build cannot work it out.
const runUnseen = text => new Function(text.slice(process.argv.length - process.argv.length))();
runUnseen(`const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched";`);
console.log(before, "|", sep, join("a", "b"), "|", names.sep, names.join("a", "b"), "|", path.sep, path.join("a", "b"));
