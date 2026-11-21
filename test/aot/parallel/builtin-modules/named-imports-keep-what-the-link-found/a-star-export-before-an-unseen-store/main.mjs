// Names that a file hands on by a star over node:path are first read behind a store that the build cannot see: they hold what the link found.
import { sep, join } from "./star.mjs";
// The text is cut at a number of the run, so the build cannot work it out.
const runUnseen = text => new Function(text.slice(process.argv.length - process.argv.length))();
runUnseen(`const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched";`);
console.log(sep, join("a", "b"));
const names = await import("./star.mjs");
console.log(names.sep, names.join("a", "b"), Object.keys(names).length, "default" in names);
