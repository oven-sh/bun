// A program compiled in place sees the paths that plain Bun shows it.
// Flags: --compile-in-place
import { where as whereEsm } from "./sub/esm.ts";
const cjs = require("./sub/lib.cjs");
function here(): string {
  return (new Error("x").stack ?? "").split("\n")[1].trim();
}
console.log("main path", import.meta.path);
console.log("main dir", import.meta.dir, "|", import.meta.dirname);
console.log("main file", import.meta.file, "|", import.meta.filename);
console.log("main url", import.meta.url);
console.log("main stack", here());
console.log("esm", whereEsm());
console.log("cjs", cjs.where());
