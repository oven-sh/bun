import f from "./p.bin" with { type: "file" };
const v = String(f)
  .split("/")
  .pop()
  .replace(/-[0-9a-z]+/, "");
import "./helper.cjs";
import "./late.mjs";
console.log(
  "root",
  typeof v === "string" ? v.trim() : typeof v,
  globalThis.w ? (typeof globalThis.w() === "string" ? globalThis.w().trim() : typeof globalThis.w()) : "",
);
