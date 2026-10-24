/** @typedef {{ x: number, y: number }} Point */

/**
 * @typedef {object} User
 * @property {number} id
 * @property {string} [name]
 */

/**
 * @callback Reducer
 * @param {number} total
 * @param {Point} p
 * @returns {number}
 */

/**
 * @template T
 * @typedef {{ one: T, many: T[] }} Both
 */

/**
 * @template T
 */
export class Box {
  /** @param {T} content */
  constructor(content) {
    /** @type {T} */
    this.content = content;
  }
  /** @returns {T} */
  get() {
    return this.content;
  }
  init() {
    this.late = 1;
  }
}

/**
 * @overload
 * @param {number} v
 * @returns {number}
 */
/**
 * @overload
 * @param {string} v
 * @returns {string}
 */
/**
 * @param {number | string} v
 * @returns {number | string}
 */
export function twice(v) {
  return typeof v === "number" ? v * 2 : v + v;
}

/**
 * @this {Point}
 * @param {number} n
 * @returns {number}
 */
export function shifted(n) {
  return this.x + this.y + n;
}

/**
 * @param {number} a
 * @param {number} [b]
 * @param {...number} rest
 * @returns {number}
 */
export function add(a, b, ...rest) {
  return a + (b ?? 0) + rest.length;
}

export function expando() {
  return 1;
}
expando.version = 2;
expando.nested = { deep: "d" };

export const open = {};
open.a = 1;
open.b = "two";

export const frozen = Object.freeze({ low: 1, high: 2 });

/** @type {Readonly<Record<string, number>>} */
export const table = { a: 1 };

export const property = {
  /** @type {number | string} */
  wide: 1,
  /** @param {number} n */
  method(n) {
    return n + 1;
  },
};
