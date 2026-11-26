import { v } from "./dep.mjs";
console.log("late", typeof v === "string" ? v.trim() : typeof v);
