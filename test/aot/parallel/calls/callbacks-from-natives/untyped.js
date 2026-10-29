"use strict";
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function compareOne(a) { return typeof a === "number" ? 0 : 1; }
function compareNone() { return 0; }
function compareFour(a, b, c, d) { return (a < b ? -1 : a > b ? 1 : 0) + (c === undefined && d === undefined ? 0 : 100); }
function compareRest(...r) { return r.length === 2 ? (r[0] < r[1] ? -1 : r[0] > r[1] ? 1 : 0) : NaN; }
function compareArguments() { return arguments.length === 2 ? (arguments[0] < arguments[1] ? -1 : arguments[0] > arguments[1] ? 1 : 0) : NaN; }
function compareThis(a, b) { return this === undefined ? (a < b ? -1 : a > b ? 1 : 0) : NaN; }
function makeCounting() { let calls = 0; const f = function (a, b) { calls++; return a < b ? -1 : a > b ? 1 : 0; }; f.calls = () => calls; return f; }
function makeThrowing(at) { let calls = 0; return function (a, b) { if (++calls === at) throw new RangeError("call " + calls); return a < b ? -1 : a > b ? 1 : 0; }; }
async function compareAsync(a, b) { return a - b; }
function* compareGenerator(a, b) { yield a - b; }
class Comparer { constructor(sign) { this.sign = sign; } compare(a, b) { return this.sign * (a < b ? -1 : a > b ? 1 : 0); } static compare(a, b) { return a < b ? 1 : a > b ? -1 : 0; } }
function seen(thisValue, list) { return typeof thisValue + ":" + list.map(v => typeof v === "object" && v !== null ? "o" : String(v)).join("/"); }
function visit(v, i, all) { this.log.push(seen(this, [v, i, all])); return v; }
function count0() { return "0:" + arguments.length; }
function count3(a, b, c) { return "3:" + arguments.length + ":" + [a, b, c].map(String).join(); }
function count9(a, b, c, d, e, f, g, h, i) { return "9:" + arguments.length + ":" + [a, b, c, d, e, f, g, h, i].map(String).join(); }
function countRest(a, ...r) { return "r:" + String(a) + ":" + r.length + ":" + r.map(String).join(); }
module.exports = { compare, compareOne, compareNone, compareFour, compareRest, compareArguments, compareThis, makeCounting, makeThrowing, compareAsync, compareGenerator, Comparer, visit, count0, count3, count9, countRest };
