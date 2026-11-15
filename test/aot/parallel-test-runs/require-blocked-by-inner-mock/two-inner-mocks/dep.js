import { inner } from "./inner.js";
import { other } from "./other.js";
globalThis.bodies++;
console.log("| the body starts");
export const flag = "real " + inner + " " + other;
