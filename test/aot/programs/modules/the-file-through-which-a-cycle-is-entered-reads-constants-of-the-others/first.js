import { b, late } from "./second.js";
import * as second from "./second.js";
export const a = 1;
if (b !== 2) require("./never.cjs");
if (second.b !== 2) require("./never.cjs");
console.log("first runs", b, second.b + 1, late());
export function describe() {
  return b === 2 ? "two" : require("./never.cjs");
}
