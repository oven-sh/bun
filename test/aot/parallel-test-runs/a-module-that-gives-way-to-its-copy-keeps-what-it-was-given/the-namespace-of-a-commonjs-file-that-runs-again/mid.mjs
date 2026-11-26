import { v } from "./a.cjs";
console.log("mid", typeof v === "string" ? v.trim() : typeof v);
export const ofMid = v;
