/** @type {(x: number) => string} */
function f1(x) { return ""; }
/** @type {(x: number) => string} */
const f2 = function (x) { return ""; };
/** @type {(x: number) => string} */
const f3 = x => "";
/**
 * @template T
 * @param {T} a
 * @param {number} [b]
 * @param c
 * @returns {T}
 */
function f4(a, b, c, { d }) { return a; }
/** @this {Window} @returns {number} */
function f5() { return 1; }
/** @this {Window} */
function f6(this) {}
function f7() {
    /** @type {number} */
    return (/** @type {string} */ (/** @satisfies {object} */ ({})));
}
/** @type {number} */
module.exports = 1;
/** @type {string} */
exports.a = "a";
/** @satisfies {string} */
exports.b = "b";
/** @private @readonly */
this.c = 1;
/** @type {number} */
F.prototype.d = 1;
/** @type {number} */
x.y.z = 1;
/** @type {number} */
x = 1;
/** @template T */
const Cls = /** @template U */ class {};
/** @type {number} */
export default 1;
class P {
    /** @type {number} @protected */
    p = 1;
    /** @type {number} */
    get g() { return 1; }
    /** @public @override */
    constructor() {}
    /** @private */
    static s() {}
    /** @param {number} v */
    set g(v) {}
}
/** @type {number} */
var v1 = 1, v2 = 2;
var /** @type {string} */ v3 = "", v4;
