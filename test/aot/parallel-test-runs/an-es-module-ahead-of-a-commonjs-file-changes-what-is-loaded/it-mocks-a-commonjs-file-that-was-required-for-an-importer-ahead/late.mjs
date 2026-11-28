import { v } from "./dep.cjs";
console.log("late", typeof v === "string" ? v.trim() : typeof v);
