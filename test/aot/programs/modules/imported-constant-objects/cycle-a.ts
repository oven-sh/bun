import { early } from "./cycle-b";
export const Cyclic = { a: 1, made: String(2) };
export function readCyclicLiteral() {
  return Cyclic.a;
}
export function readCyclicMade() {
  return Cyclic.made;
}
export const seenEarly = early;
