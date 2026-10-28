import { column } from "./tables";
const nothing = { low: {}, high: {} };
export const prices = column("prices", nothing);
export function neverCalled() {
  return nothing;
}
