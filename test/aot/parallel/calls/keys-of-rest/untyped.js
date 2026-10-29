"use strict";
function byBoolean(a, ...args) { const k = a === 1; return String(args[k]); }
function byBooleanOfArguments(a) { const k = a === 1; return String(arguments[k]); }
function byInteger(n, ...args) { let s = ""; for (let i = -2; i < 4; i++) s += String(args[i]) + ","; return s; }
function byIntegerOfArguments() { let s = ""; for (let i = -2; i < 4; i++) s += String(arguments[i]) + ","; return s; }
function byHalf(...args) { let s = ""; for (let i = 0; i < 5; i++) s += String(args[i * 0.5]) + ","; return s; }
function byNegativeZero(...args) { let z = -0; for (let i = 0; i < 2; i++) z = z * 1; return String(args[z]) + Object.is(z, -0); }
function byNotANumber(...args) { let z = 0 / 0; return String(args[z]) + String(args[1 / 0]) + String(args[-1 / 0]); }
function byLarge(...args) { let s = ""; for (let i = 4294967294; i < 4294967298; i++) s += String(args[i]) + ","; for (let i = 2147483646; i < 2147483650; i++) s += String(args[i]) + ","; return s; }
function byHuge(...args) { let s = ""; for (let i = 9007199254740990; i < 9007199254740992; i++) s += String(args[i]) + ","; return s + String(args[1e300]) + String(args[-1e300]); }
function byOptionalInteger(flag, ...args) { const k = flag ? 1 : undefined; return String(args[k]); }
function byOptionalNumber(flag, ...args) { const k = flag ? 0.5 + 0.5 * args.length : null; return String(args[k]); }
function byString(...args) { let k = ""; for (let i = 0; i < 1; i++) k += "1"; return String(args[k]) + String(args[k + "x"]) + String(args["leng" + "th".slice(0, 2)]); }
function bySymbol(...args) { const k = Symbol("s"); return String(args[k]) + typeof args[Symbol.iterator]; }
function byBigInt(...args) { let k = 0n; for (let i = 0; i < 1; i++) k += 1n; return String(args[k]); }
function byObject(...args) { let log = ""; const k = { toString() { log += "k"; return "1"; } }; return String(args[k]) + log; }
function byThrowingObject(...args) { const k = { toString() { throw new RangeError("key"); } }; return String(args[k]); }
function byNumberOrString(flag, ...args) { const k = flag ? 1 : "0"; return String(args[k]); }
function byAnything(k, ...args) { return String(args[k]); }
function byAnythingOfArguments(k) { return String(arguments[k]); }
function skipsTwo(a, b, ...args) { let s = ""; for (let i = -1; i < 3; i++) s += String(args[i]) + ","; return s; }
function underHandler(...args) { let s = ""; try { for (let i = 0; i < 3; i++) s += String(args[i]); throw 1; } catch (e) { for (let i = 0; i < 3; i++) s += String(args[i]); } return s; }
module.exports = { byBoolean, byBooleanOfArguments, byInteger, byIntegerOfArguments, byHalf, byNegativeZero, byNotANumber, byLarge, byHuge, byOptionalInteger, byOptionalNumber, byString, bySymbol, byBigInt, byObject,
  byThrowingObject, byNumberOrString, byAnything, byAnythingOfArguments, skipsTwo, underHandler };
