import { nameOf } from "./main.mjs";
// The text is cut at a number of the run, so the build cannot work it out.
const text = `process.getBuiltinModule("node:path").basename = () => "patched";`;
new Function(text.slice(process.argv.length - process.argv.length))();
console.log("b runs:", nameOf("/a/b.txt"));
