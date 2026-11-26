import v from "./p.json" with { type: "text" };
import w from "./p.json";
globalThis.w = () => w;
import "./helper.cjs";
import "./late.mjs";
console.log(
  "root",
  typeof v === "string" ? v.trim() : typeof v,
  globalThis.w ? (typeof globalThis.w() === "string" ? globalThis.w().trim() : typeof globalThis.w()) : "",
);
