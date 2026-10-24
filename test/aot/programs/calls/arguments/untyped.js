"use strict";
const log = [];
function attempt(what, run) { try { log.push(what + ": " + String(run())); } catch (e) { log.push(what + " throws " + e.constructor.name); } }
function names() { return [arguments["length"], arguments["0"], String(arguments[-1]), String(arguments[1.5]), String(arguments[5]), typeof arguments[Symbol.iterator], String(arguments.foo), Object.prototype.toString.call(arguments)].join(" "); }
function callee() { return arguments.callee; }
function calleeByKey(k) { return arguments[k]; }
function stored() { arguments[0] = 9; return arguments[0] + " " + arguments.length; }
function lengthStored() { arguments.length = 1; return arguments.length + " " + Array.prototype.slice.call(arguments).length; }
function returned() { return arguments; }
function passed(f) { return f(arguments); }
function passedThenRead(f) { f(arguments); return arguments[1] + " " + arguments.length; }
function readThenPassed(f) { const n = arguments.length, x = arguments[1]; return n + " " + x + " " + f(arguments); }
function spread(f) { return f(...arguments); }
function iterated() { let s = ""; for (const x of arguments) s += x; return s; }
function keyObject() { return arguments[{ toString() { log.push("key converted"); return "1"; } }]; }
function identity() { const a = arguments; return a === arguments; }
function captured() { const inner = () => arguments.length + ":" + arguments[0]; return inner("x", "y", "z"); }
function forwarded(f) { return f.apply(this, arguments); }
function forwardedToOwnApply() { const f = function () {}; f.apply = (t, list) => Object.prototype.toString.call(list) + list.length; return f.apply(this, arguments); }
function inLoop(f) { let s = ""; for (let i = 0; i < 2; i++) s += f.apply(null, arguments) + ";"; return s; }
function sliceVariants() { return [Array.prototype.slice.call(arguments), Array.prototype.slice.call(arguments, 1), [].slice.call(arguments, 0, 1), Array.prototype.slice.call(arguments, -1)].map(a => Array.isArray(a) + "" + a.join("")).join(" "); }
function parameters(a, b) { a = 5; return arguments[0] + " " + arguments.length + " " + String(b); }
function typeOfIt() { return typeof arguments + " " + (arguments instanceof Object) + " " + Array.isArray(arguments) + " " + JSON.stringify(arguments) + " " + Object.keys(arguments).join(","); }
const show = function () { return arguments.length + "[" + Array.prototype.map.call(arguments, x => typeof x === "function" ? "fn" : x).join(",") + "]"; };
attempt("names", () => names("a", "b"));
attempt("callee", () => callee());
attempt("callee by key", () => calleeByKey("callee"));
attempt("length by key", () => calleeByKey("length"));
attempt("index by key", () => calleeByKey(0));
attempt("stored", () => stored(1, 2));
attempt("length stored", () => lengthStored(1, 2, 3));
attempt("returned", () => returned(1, 2).length);
attempt("passed", () => passed(a => a.length + typeof a[0]));
attempt("passed then read", () => passedThenRead(a => { a[1] = "changed"; a.length = 7; }, "kept"));
attempt("read then passed", () => readThenPassed(a => { a[1] = "changed"; return a[1]; }, "kept"));
attempt("spread", () => spread(show, 1, 2));
attempt("iterated", () => iterated("a", "b", "c"));
attempt("key object", () => keyObject("a", "b"));
attempt("identity", () => identity());
attempt("captured", () => captured(1, 2));
attempt("forwarded", () => forwarded(show, 1, 2));
attempt("forwarded, own apply", () => forwardedToOwnApply(1, 2));
attempt("in loop", () => inLoop(show, 1));
attempt("slice", () => sliceVariants("a", "b", "c"));
attempt("parameters", () => parameters(1));
attempt("typeof", () => typeOfIt("a", "b"));
attempt("none", () => names());
attempt("many", () => show(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12));
console.log(log.join("\n"));
