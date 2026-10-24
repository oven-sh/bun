export function hoisted() {
  return "hoisted";
}
export const before = "before";
const k = require("./k.cjs");
export const later = "later";
export const seen = k.seen;
export const readLater = k.readLater;
