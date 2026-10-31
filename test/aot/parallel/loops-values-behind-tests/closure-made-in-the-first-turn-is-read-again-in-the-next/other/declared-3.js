import { told } from "./declared-2.js";
export function look2(it) {
  return [told(() => it.norm?.()), told(() => it.__late)].map(String).join(",");
}
export function mark3(given, value) {
  Object.defineProperty(given, "x", {});
  return given;
}
export function look3(it) {
  return [told(() => String(it.x)), told(() => typeof it.x)].map(String).join(",");
}
