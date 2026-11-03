const limit = 5;
export const label = "text";
const doubled = limit * 2;
const copy = label;
import { readAll } from "./second.mjs";
export function readLimit() {
  return limit;
}
export function readLabel() {
  return label;
}
export function readDoubled() {
  return doubled;
}
export function readCopy() {
  return copy;
}
export function readTypes() {
  return typeof limit + " " + typeof label;
}
export function readDeclaredLater() {
  return declaredLater;
}
const declaredLater = 6;
console.log("first", readAll());
