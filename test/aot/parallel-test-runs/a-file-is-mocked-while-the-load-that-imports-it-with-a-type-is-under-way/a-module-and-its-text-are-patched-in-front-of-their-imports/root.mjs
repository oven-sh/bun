import "./helper.mjs";
import v from "./p.mjs" with { type: "text" };
import { v as w } from "./p.mjs";
globalThis.w = () => w;
import "./late.mjs";
console.log(
  "root",
  typeof v === "string" ? v.trim() : typeof v,
  globalThis.w ? (typeof globalThis.w() === "string" ? globalThis.w().trim() : typeof globalThis.w()) : "",
);
