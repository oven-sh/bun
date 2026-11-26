import v from "./p.toml";
console.log("late", typeof v === "string" ? v.trim() : typeof v);
