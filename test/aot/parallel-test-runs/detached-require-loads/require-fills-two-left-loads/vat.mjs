import { thread } from "./spool.mjs";
import { color } from "./dye.mjs";
console.log("the body of vat runs over", thread, color);
export const label = "vat " + thread + " " + color;
