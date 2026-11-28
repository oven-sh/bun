import { platform as v } from "node:os";
console.log("late", typeof v === "string" ? v.trim() : typeof v);
