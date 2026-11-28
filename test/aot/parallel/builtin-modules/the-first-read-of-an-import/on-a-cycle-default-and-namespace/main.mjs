// A file on a cycle calls functions of the entry that read a default import of node:path and a namespace of node:os before the body of the entry has run.
import "./b.mjs";
import path from "node:path";
import * as os from "node:os";
export function nameOf(file) {
  return path.basename(file);
}
export function endOfLine() {
  return JSON.stringify(os.EOL) + " " + Object.keys(os).includes("EOL");
}
console.log("the entry runs:", nameOf("/c/d.js"), endOfLine());
