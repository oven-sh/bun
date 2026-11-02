import { a } from "./cycle-a.mjs";
import { readFileSync } from "node:fs";
console.log("never", a);
export const c = typeof readFileSync;
