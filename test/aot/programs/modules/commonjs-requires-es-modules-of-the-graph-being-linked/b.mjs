import { shared } from "./shared.mjs";
import { c } from "./c.mjs";
import other from "./other.cjs";
console.log("b runs");
export const b = "b(" + shared.length + "," + c.length + "," + other + ")";
