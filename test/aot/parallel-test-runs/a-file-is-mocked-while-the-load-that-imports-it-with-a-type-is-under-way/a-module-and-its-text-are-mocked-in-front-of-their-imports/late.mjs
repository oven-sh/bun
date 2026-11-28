import v from "./p.mjs" with { type: "text" };
import { v as w } from "./p.mjs";
globalThis.w = () => w;
console.log("late", typeof v === "string" ? v.trim() : typeof v);
