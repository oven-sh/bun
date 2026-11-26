import "./helper.cjs";
import v from "./p.toml";
console.log(
  "root",
  typeof v === "string" ? v.trim() : typeof v,
  globalThis.w ? (typeof globalThis.w() === "string" ? globalThis.w().trim() : typeof globalThis.w()) : "",
);
