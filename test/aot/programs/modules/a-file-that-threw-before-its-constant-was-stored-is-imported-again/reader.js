import { debug } from "./flags.js";
console.log("reader runs");
if (debug) console.log("never");
else console.log("not debug");
export function read() {
  return debug;
}
