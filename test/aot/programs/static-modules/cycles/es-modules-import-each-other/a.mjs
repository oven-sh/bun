import { seen, readLater } from "./b.mjs";
export function hoisted() {
  return "hoisted";
}
export const constant = "constant";
export let variable = "variable";
export const fromB = seen;
export { readLater };
