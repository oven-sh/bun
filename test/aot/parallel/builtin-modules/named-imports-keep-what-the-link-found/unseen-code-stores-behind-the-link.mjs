// A text that the build cannot read loads node:path behind the link of the entry and stores into it: named imports that nothing has read yet keep what the link found.
import { sep, join } from "node:path";
// The text is cut at a number of the run, so the build cannot work it out.
const runUnseen = text => new Function(text.slice(process.argv.length - process.argv.length))();
runUnseen(`const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched";`);
console.log(sep, join("a", "b"));
console.log(
  runUnseen(`const path = process.getBuiltinModule("node:path"); return path.sep + " " + path.join("a", "b");`),
);
