import { right } from "./cycle-right.mjs";
import inCycle from "./in-cycle.cjs";
console.log("cycle-left runs");
export function left() {
  return "left(" + inCycle + "," + right() + ")";
}
