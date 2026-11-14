import { shared } from "./shared.mjs";
const cut = path => path.replaceAll("\\", "/").replace(/.*\/lib/, "lib");
globalThis.loads = (globalThis.loads ?? 0) + 1;
let count = 0;
export const order = globalThis.loads;
export const url = cut(import.meta.url);
export const path = cut(import.meta.path);
export const file = import.meta.file;
export const dir = cut(import.meta.dir);
export const main = import.meta.main;
export { shared };
export function bump() {
  count++;
}
export function read() {
  return count;
}
export function fail() {
  throw new Error("failed");
}
