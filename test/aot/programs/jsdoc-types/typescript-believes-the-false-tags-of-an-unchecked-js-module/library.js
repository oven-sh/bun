/** @returns {number} */
export function count() {
  return "7";
}

/** @returns {string} */
export function label() {
  return 42;
}

/** @returns {{ x: number, y: number }} */
export function point() {
  return { y: "2", x: "1", z: 3 };
}

/** @returns {number[]} */
export function list() {
  return ["1", 2, null];
}

/** @returns {(n: number) => number} */
export function step() {
  return n => n + "!";
}

/** @returns {boolean} */
export function flag() {
  return 0;
}

/** @returns {number} */
export function nothing() {}

/** @type {number} */
export const limit = "10";

/** @type {3} */
export const version = 4;

/** @type {number} */
export let mutable = 1;

export function spoil() {
  mutable = "spoiled";
}

export class Dog {
  /** @param {string} name */
  constructor(name) {
    /** @type {string} */
    this.name = name.length;
    /** @type {number} */
    this.legs = "four";
  }

  /** @returns {number} */
  bark() {
    return "woof";
  }

  /** @type {number} */
  static kinds = "many";
}

/**
 * @param {number} n
 * @param {string} s
 * @returns {string}
 */
export function takes(n, s) {
  return typeof n + " " + typeof s + " " + (n + s);
}

/**
 * @param {(n: number) => number} f
 * @returns {number[]}
 */
export function callBack(f) {
  return [f("1"), f(null), f()];
}

/**
 * @template T
 * @param {T} value
 * @returns {T[]}
 */
export function wrap(value) {
  return value;
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
export function isNumber(v) {
  return true;
}

/** @returns {never} */
export function fail() {
  return "came back";
}

/** @enum {number} */
export const Level = { Low: "low", High: 2 };
