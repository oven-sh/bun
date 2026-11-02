import { lines } from "./declared-1.js";
export function show(value, depth = 0) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return String(value);
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 2) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  return (value.constructor && value.constructor !== Object ? value.constructor.name : "") + "{" + Object.keys(value).map(key => key + ":" + show(value[key], depth + 1)).join(",") + "}";
}
export function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
