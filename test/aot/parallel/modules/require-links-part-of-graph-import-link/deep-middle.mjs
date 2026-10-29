import { value as bottom } from "./deep-bottom.mjs";
import { base } from "./file.cjs";
console.log("deep middle runs");
export const value = bottom + base;
