// A text that the build cannot read is handed the default import of node:path and stores into it: the named imports keep what the link found.
import path, { sep, join } from "node:path";
// The text is cut at a number of the run, so the build cannot work it out.
const text = `path.sep = "!"; path.join = () => "patched";`;
new Function("path", text.slice(process.argv.length - process.argv.length))(path);
console.log(sep, join("a", "b"), path.sep, path.join("a", "b"));
