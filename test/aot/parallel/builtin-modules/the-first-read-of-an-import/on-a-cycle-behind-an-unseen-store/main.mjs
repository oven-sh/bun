// A file on a cycle stores into node:path by a text that the build cannot read, then calls a function of the entry that reads a named import before the body of the entry has run.
import "./b.mjs";
import { basename } from "node:path";
export function nameOf(file) {
  return basename(file);
}
console.log("the entry runs:", nameOf("/c/d.js"));
