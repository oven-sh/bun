import "./calls-early.js";
import { debug } from "./flags.js";
export function describe() {
  if (debug) return "debug";
  return "quiet";
}
console.log("reader runs:", describe());
