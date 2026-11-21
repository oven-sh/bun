// A file on a cycle calls a function of the entry that reads a named import of node:path before the body of the entry has run.
import { describe } from "./b.mjs";
import { basename } from "node:path";
export function nameOf(file) {
  return basename(file);
}
console.log("the entry runs:", describe(), basename("/c/d.js"));
