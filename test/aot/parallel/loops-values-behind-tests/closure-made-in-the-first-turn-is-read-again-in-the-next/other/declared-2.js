import { key, read } from "./declared-1.js";
export function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
export function mark0(given, value) {
  given[key("size")] = value;
  return given;
}
export function look0(it) {
  return [told(() => Object.hasOwn(it, "size")), told(() => typeof it.size)].map(String).join(",");
}
export function mark1(given, value) {
  given.inherited = value;
  return given;
}
export function look1(it) {
  return [
    told(() => JSON.stringify(it)),
    told(() => it.norm?.()),
    told(() => read(it)),
    told(() => Object.getOwnPropertyDescriptor(it, "inherited")?.enumerable),
  ]
    .map(String)
    .join(",");
}
export function mark2(given, value) {
  if (value === 2) Object.defineProperty(given, "__late", { enumerable: true });
  else given.__late = value;
  return given;
}
