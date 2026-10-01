function Ctor() { this.p = 1; this.arr = []; }
Ctor.prototype.m = function () { this.q = null; return this.q; };
class C2 { constructor() { /** @type {string} */ this.typed = 1; this.self = this.self; } m() { this.late = 2; } }
const o = {}; Object.defineProperty(o, "dp", { value: 1 }); Object.defineProperty(o, "acc", { get() { return "s"; } });
function f() {} f.expando = []; f.n = undefined;
module.exports = { a: 1 }; module.exports.b = 2; exports.c = undefined; exports.c = 3;
/** @typedef {{ x: number }} TD */
/** @type {TD} */ const td = { x: "no" };
/** @param {TD} p @returns {number} */ const arrowFn = p => p.x.y;
