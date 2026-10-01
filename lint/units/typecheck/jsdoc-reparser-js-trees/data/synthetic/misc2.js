const p = 1;
const o = {
  /** @type {number} */
  p,
  /** @satisfies {number} */
  s = 2,
};
/** @implements {J} */
class A implements I {}
/** @augments {Base<string>} */
class B extends Base {}
/**
 * @overload
 * @param {string} a
 * @returns {string}
 */
/**
 * @overload
 * @param {number} a
 * @returns {number}
 */
/** @param {string | number} a */
function ov(a) { return a; }
class C {
  /**
   * @overload
   * @param {string} a
   */
  constructor(a) {}
  /**
   * @overload
   * @param {boolean} a
   * @returns {boolean}
   */
  m(a) { return a; }
}
/** @typedef {number} AtEnd */
