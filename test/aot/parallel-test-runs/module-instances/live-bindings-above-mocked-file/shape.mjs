import { bump, count } from "./counter.mjs";
export function describe() {
  return "shape sees " + count;
}
export function bumpThroughCycle() {
  return bump();
}
export const early = typeof bump;
