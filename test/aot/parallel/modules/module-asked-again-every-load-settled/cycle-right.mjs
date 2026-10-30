import { name as other } from "./cycle-left.mjs";
console.log("right runs");
export function name() { return "right of " + other.name; }
