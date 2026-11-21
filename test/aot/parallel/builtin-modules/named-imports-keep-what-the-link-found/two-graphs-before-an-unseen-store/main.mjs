// Two graphs import a name of node:path and read nothing, then a text that the build cannot read loads the module and stores: both read what their links found.
import { sep } from "node:path";
const second = await import("./second.mjs");
// The text is cut at a number of the run, so the build cannot work it out.
const runUnseen = text => new Function(text.slice(process.argv.length - process.argv.length))();
runUnseen(`process.getBuiltinModule("node:path").sep = "!";`);
const names = await import("node:path");
console.log(
  "the entry:",
  sep,
  "the second graph:",
  second.read(),
  "import():",
  names.sep,
  "its default:",
  names.default.sep,
);
