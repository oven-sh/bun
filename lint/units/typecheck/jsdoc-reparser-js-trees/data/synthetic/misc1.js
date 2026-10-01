foo(); /** @type {number} */ var sameLine = 1;
/** @typedef {number} A */
/** @type {A} */
var two = 1;
const o = {
  /** @typedef {string} InObj */
  /** @type {InObj} */
  p: "x",
  /** @satisfies {InObj} */
  q,
  /** @type {(a: number) => void} */
  m(a) {},
  /** @param {number} a @returns {string} */
  n: function (a) { return ""; },
};
function f(/** @type {{a: number, b?: string}} */ x, /** @type {number=} */ y) {
  /** @typedef {boolean} InBody */
  /** @this {Window} @param {...string} rest */
  function inner(...rest) {}
  return /** @type {InBody} */ (x);
}
/** @implements {I} @implements {J} */
class K extends /** @type {any} */ (Base) { /** @readonly @private */ x = 1; /** @override @protected */ m() {} /** @public */ constructor() { super(); } }
/** @template {string} T @template U @param {T} a @param {U} [b] @param c.d @returns {asserts a is T} */
const g = (a, b, c) => {};
/** @type {number} */
this.prop = 1;
/** @type {string} */
module.exports.e = "";
/** @typedef {object} Obj
 * @property {string} a-b
 * @property {number[]} [c]
 * @property {object} d
 * @property {string} d.e
 */
/** @callback Cb @param {string} 1x @param {number} [opt] @returns {void} */
export default /** @type {Cb} */ (null);
/** @import { X } from "./x" */
/** @import * as ns from "./ns" */
