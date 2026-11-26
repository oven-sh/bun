import f from "./p.bin" with { type: "file" };
const v = String(f)
  .split("/")
  .pop()
  .replace(/-[0-9a-z]+/, "");
console.log("late", typeof v === "string" ? v.trim() : typeof v);
