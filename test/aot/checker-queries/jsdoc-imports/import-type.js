// A type that JSDoc imports is the checker's type of the parameter.
/** @typedef {import("./shapes").Point} Point */
/** @import { Size } from "./shapes" */

/** @param {import("./shapes").Point} p */
export function norm(p) {
  return p.x + p.y;
}

/** @param {Point} q */
export function twice(q) {
  return q.x * 2;
}

/** @param {Size} s */
export function area(s) {
  return s.width * s.height;
}
