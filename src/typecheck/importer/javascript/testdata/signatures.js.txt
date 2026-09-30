/**
 * @overload
 * @param {string} a
 * @returns {string}
 */
/**
 * @template T
 * @overload
 * @param {T} a
 * @returns {T}
 */
/** @param {any} a */
export function f(a) { return a; }
class C {
  /**
   * @overload
   * @param {number} x
   */
  constructor(x) {}
  /**
   * @overload
   * @param {number} x
   * @returns {void}
   */
  static m(x) {}
}
/**
 * @param {object} o
 * @param {string} o.a
 * @param {number} [o.b]
 * @param {object[]} list
 * @param {string} list[].c
 */
function nested(o, list) {}
/** @type {number} */
export default 5;
/** @satisfies {number} */
export default 6;
