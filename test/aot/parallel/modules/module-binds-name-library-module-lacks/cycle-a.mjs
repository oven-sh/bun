import { b } from "./cycle-b.mjs";
import { existsSync } from "node:fs";
console.log("never", b);
export const a = typeof existsSync;
