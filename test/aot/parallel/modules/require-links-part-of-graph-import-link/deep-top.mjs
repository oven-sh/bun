import { value as middle } from "./deep-middle.mjs";
import { name } from "./names.mjs";
console.log("deep top runs");
export const value = middle + name.length;
