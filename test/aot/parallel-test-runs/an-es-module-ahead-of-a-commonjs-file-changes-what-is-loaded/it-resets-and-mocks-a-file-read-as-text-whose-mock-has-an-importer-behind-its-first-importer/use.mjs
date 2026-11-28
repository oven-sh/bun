import v from "./dep.json" with { type: "text" };
console.log("use", typeof v === "string" ? v.trim() : typeof v);
