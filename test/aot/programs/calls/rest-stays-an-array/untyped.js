"use strict";
var kept = [];
function storesElement(...args) { args[0] = 9; return args[0] + ":" + args.length; }
function storesLength(...args) { args.length = 1; return args.length + ":" + args[1]; }
function pushes(...args) { args.push(7); return args.length + ":" + args[args.length - 1]; }
function aliased(...args) { const a = args; a[0] = "a"; return args[0] + ":" + (a === args); }
function mutate(list) { list[0] = "mutated"; list.push("more"); }
function escapesThenReads(...args) { mutate(args); return args[0] + ":" + args.length; }
function readsThenEscapes(...args) { const n = args.length, first = args[0]; mutate(args); return n + ":" + first; }
function escapesInLoop(...args) { for (let i = 0; i < 3; i++) kept.push(args); return kept[kept.length - 1] === kept[kept.length - 3]; }
function escapesOnOnePath(flag, ...args) { if (flag) { kept.push(args); return args.length; } return args.length + args[0]; }
function escapesOnOnePathThenReads(flag, ...args) { if (flag) mutate(args); return args[0] + ":" + args.length; }
function returned(...args) { return args; }
function captured(...args) { return () => args; }
function capturedAndStored(...args) { const f = () => args[0]; args[0] = "late"; return f(); }
function outOfBounds(...args) { return [args[5], args[-1], args[1.5], args[4294967295], args[args.length], args[1048575], args[1048576], args[1048577], args[1000000000], args[2147483647], args[2147483648], args[4294967296], args[9007199254740991]].map(String).join(); }
function byName(...args) { return [args["0"], args["length"], typeof args["map"], args.constructor === Array, typeof args[Symbol.iterator], Array.isArray(args)].join(); }
function byKey(key, ...args) { return String(args[key]); }
function keyWithEffects(...args) { let log = ""; const key = { toString() { log += "k"; return "1"; } }; const v = args[key]; return log + v; }
function inOperator(...args) { return (0 in args) + ":" + (3 in args) + ":" + ("length" in args); }
function forOf(...args) { let s = ""; for (const a of args) s += a; return s; }
function forIn(...args) { let s = ""; for (const k in args) s += k; return s; }
function spreadIntoArray(...args) { const b = [0, ...args, 9]; return b.join(); }
function destructured(...[a, b = "d", ...more]) { return a + ":" + b + ":" + more.length; }
function withDefault(a = "x", ...args) { return a + ":" + args.length + ":" + args[0]; }
function calleeMutatesArguments() { arguments[0] = "changed"; arguments.length = 0; return "ok"; }
function appliesThenReads(...args) { const r = calleeMutatesArguments.apply(null, args); return r + ":" + args[0] + ":" + args.length; }
function appliesInLoop(f, ...args) { let s = ""; for (let i = 0; i < 3; i++) s += f.apply(null, args) + args.length; return s; }
function spreadsThenReads(f, ...args) { return f(...args) + ":" + args.length; }
function inCatch(...args) { try { throw new Error("e"); } catch (e) { return args.length + ":" + args[1]; } }
function throwsBetween(f, ...args) { const n = args.length; try { f(); } catch (e) { kept.push(args); } return n + ":" + args[0]; }
function typeOfIt(...args) { return typeof args + ":" + (args instanceof Array) + ":" + Object.prototype.toString.call(args); }
function toStringOfIt(...args) { return "" + args; }
function json(...args) { return JSON.stringify(args); }
function compared(...args) { return (args == null) + ":" + (args === undefined) + ":" + !args; }
function recursive(n, ...args) { return n ? recursive(n - 1, n, ...args) : args.length + ":" + args[0] + ":" + args[args.length - 1]; }
function* generator(...args) { yield args.length; yield args[0]; yield args; }
async function asynchronous(...args) { await null; return args.length + ":" + args[1]; }
function Constructed(...args) { this.n = args.length; this.first = args[0]; }
function sloppyLength() { return arguments.length; }
function argumentsEscape() { return arguments; }
function argumentsByName() { return [typeof arguments.callee, arguments["length"], Object.prototype.toString.call(arguments), typeof arguments[Symbol.iterator]].join(); }
function argumentsOutOfBounds() { return String(arguments[3]) + String(arguments[-1]) + String(arguments["x"]); }
function argumentsStored() { arguments[1] = "s"; return arguments[1] + ":" + arguments.length; }
function argumentsLengthStored() { arguments.length = 7; return arguments.length; }
function argumentsCopied() { var out = new Array(arguments.length); for (var i = 0; i < arguments.length; i++) out[i] = arguments[i]; return out.join(); }
function argumentsSliced() { return Array.prototype.slice.call(arguments, 1).join(); }
function argumentsForwarded() { return returned.apply(this, arguments).join(); }
module.exports = { kept, storesElement, storesLength, pushes, aliased, escapesThenReads, readsThenEscapes, escapesInLoop, escapesOnOnePath, escapesOnOnePathThenReads, returned, captured, capturedAndStored,
  outOfBounds, byName, byKey, keyWithEffects, inOperator, forOf, forIn, spreadIntoArray, destructured, withDefault, appliesThenReads, appliesInLoop, spreadsThenReads, inCatch, throwsBetween, typeOfIt, toStringOfIt,
  json, compared, recursive, generator, asynchronous, Constructed, sloppyLength, argumentsEscape, argumentsByName, argumentsOutOfBounds, argumentsStored, argumentsLengthStored,
  argumentsCopied, argumentsSliced, argumentsForwarded };
