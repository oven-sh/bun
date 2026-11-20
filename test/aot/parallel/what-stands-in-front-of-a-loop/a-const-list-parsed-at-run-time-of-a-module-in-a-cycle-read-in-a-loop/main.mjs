// What stands in front of a loop: a const list parsed at run time of a module in a cycle read in a loop.
import { early } from "./other.mjs";
const table = JSON.parse("[1.5, 2.5]");
export function total(turns) { let sum = 0; for (let t = 0; t < turns; t++) sum += table[t]; return sum; }
console.log("SAID " + early.join(" ") + " " + total(2));
