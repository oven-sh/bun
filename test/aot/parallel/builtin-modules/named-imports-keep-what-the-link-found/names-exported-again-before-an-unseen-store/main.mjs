// Names of node:path and node:os that a file exports again are first read behind a store that the build cannot see: they hold what the link found.
import os, { sep, j } from "./re.mjs";
// The text is cut at a number of the run, so the build cannot work it out.
const runUnseen = text => new Function(text.slice(process.argv.length - process.argv.length))();
runUnseen(
  `const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched"; process.getBuiltinModule("node:os").platform = () => "made up";`,
);
console.log(sep, j("a", "b"), os.platform());
const names = await import("./re.mjs");
console.log(Object.keys(names), names.sep, names.j("a", "b"), names.default === os);
