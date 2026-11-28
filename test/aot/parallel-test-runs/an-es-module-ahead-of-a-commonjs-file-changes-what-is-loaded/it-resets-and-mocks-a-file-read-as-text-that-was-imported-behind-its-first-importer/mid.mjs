import v from "./dep.json" with { type: "text" };
console.log("mid", typeof v === "string" ? v.trim() : typeof v);
