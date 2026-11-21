// A function reads two named imports of node:path before and behind a store that the build cannot see: it reads the same both times.
import { sep, join } from "node:path";
// The text is cut at a number of the run, so the build cannot work it out.
const runUnseen = text => new Function(text.slice(process.argv.length - process.argv.length))();
function read() {
  return sep + " " + join("a", "b");
}
const before = read();
runUnseen(`const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched";`);
console.log(before, read(), read() === before);
