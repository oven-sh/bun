import v from "./p.json" with { type: "text" };
console.log("late", typeof v === "string" ? v.trim() : typeof v);
