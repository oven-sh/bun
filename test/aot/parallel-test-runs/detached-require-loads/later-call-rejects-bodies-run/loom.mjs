import { thread } from "./spool.mjs";
import { color } from "./dye.mjs";
export const label = "loom " + thread + " " + color;
console.log("the body of loom runs:", label);
