import v from "./dep.json" with { type: "text" };
console.log("late", typeof v === "string" ? v.trim() : typeof v);
