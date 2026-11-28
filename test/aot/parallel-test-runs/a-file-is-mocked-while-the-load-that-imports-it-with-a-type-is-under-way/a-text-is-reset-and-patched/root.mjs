import v from "./p.json" with { type: "text" };
import "./helper.mjs";
console.log(
  "root",
  typeof v === "string" ? v.trim() : typeof v,
  globalThis.w ? (typeof globalThis.w() === "string" ? globalThis.w().trim() : typeof globalThis.w()) : "",
);
