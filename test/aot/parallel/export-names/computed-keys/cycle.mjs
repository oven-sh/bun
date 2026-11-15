import * as other from "./other-of-cycle.mjs";
export const seen = other.seen;
export const firstOfCycle = 1;
export let secondOfCycle = 2;
export function readsEarly(key) {
  return other.read(key);
}
