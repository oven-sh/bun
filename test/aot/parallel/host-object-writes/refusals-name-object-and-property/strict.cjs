"use strict";
// prettier-ignore
{
exports[0] = () => { Function.prototype.call$0 = function () {}; };
exports[1] = () => { Object.defineProperty(Object.prototype, "should", { get() { return 1; }, configurable: true }); };
exports[2] = () => { Object.prototype.__defineGetter__("red", function () { return this; }); };
exports[3] = () => { Object.assign(Object.prototype, { last() {} }); };
exports[4] = () => { Array.prototype[3] = 1; };
exports[5] = () => { Function.prototype.call = function () { return "x"; }; };
exports[6] = () => { Object.defineProperty(Function.prototype, "call", { value() { return "x"; } }); };
exports[7] = () => { Array.prototype[Symbol.iterator] = function* () {}; };
exports[8] = () => { Date.toString = () => "x"; };
exports[9] = () => { delete Function.prototype.call; };
exports[10] = () => { delete Array.prototype[["pu", "sh"].join("")]; };
exports[11] = () => { globalThis.Math = function () {}; };
exports[12] = () => { Math = function () {}; };
exports[13] = () => { Object.defineProperty(globalThis, "Math", { value: 1 }); };
exports[14] = () => { delete globalThis.Math; };
exports[15] = () => { Object.setPrototypeOf(Array.prototype, {}); };
exports[16] = () => { Array.prototype.__proto__ = {}; };
}
