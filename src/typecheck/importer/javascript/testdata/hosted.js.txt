/** @type {number} */
var a;
/** @type {string} */
var b = "", c;
/** @satisfies {number} */
var d = 1;
/**
 * @param {T} t
 * @param {string} [s]
 * @param {number=} n
 * @param {...number} rest
 * @returns {void}
 */
function f(t, s, n, ...rest) {}
/** @template T */
function tf() {}
/** @template {string} K */
function tk() {}
/** @type {(n: number) => string} */
const g = n => "";
/** @this {Window} */
var h = function (x) {};
var o = {
  /** @type {number} */
  p: 1,
  /** @satisfies {number} */
  q: 2,
  /** @type {number} */
  r,
  /** @param {string} k */
  m(k) {},
};
function ret(x) {
  return /** @type {string} */ (x);
}
function sat(x) {
  /** @satisfies {string} */
  return x;
}
/** @type {number} */
exports.e = 1;
/** @satisfies {number} */
module.exports.z = 3;
/** @type {number} */
this.t = 4;
class K {
  /** @type {number} */
  p = 1;
  /** @type {number} */
  get v() { return 1; }
  /** @param {string} a */
  constructor(a) {}
}
/** @param {{ x: number }} param0 */
function destructured({ x }) {}
function p(/** @type {number} */ x, /** @type {string} */ y) {}
var /** @type {number} */ vd = 1, /** @satisfies {number} */ ve = 2;
({ /** @satisfies {number} */ sh = 1 } = o);
