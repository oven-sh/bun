import v from "./dep.json";
console.log("late", typeof v === "string" ? v.trim() : typeof v);
