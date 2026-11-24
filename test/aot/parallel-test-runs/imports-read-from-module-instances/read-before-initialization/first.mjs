import * as second from "./second.mjs";
import "./dep.mjs";
export const value = 1;
export function peek() { let sum = 0; for (let i = 0; i < 300; i++) sum += second.other; return sum; }
