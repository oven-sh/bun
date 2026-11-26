import v from "./p.json" with { type: "text" };
import w from "./p.json";
globalThis.w = () => w;
console.log("late", typeof v === "string" ? v.trim() : typeof v);
