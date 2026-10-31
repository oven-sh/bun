import { name as other } from "./cycle-right.mjs";
console.log("left runs");
export function name() { return "left of " + other.name; }
