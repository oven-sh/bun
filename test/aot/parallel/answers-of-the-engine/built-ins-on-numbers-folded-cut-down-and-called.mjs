// functions of Math and Number on known numbers, on proven ranges and on anything, and Number, String, Boolean and Object called: -0, which 1 / x tells from 0, NaN, the infinities, the ends of int32 and of the safe integers, arguments that are left out, texts, objects that convert, a BigInt, a symbol, the function under another name and a local named Math
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function tell(x) { if (typeof x === "number" && x === 0) return 1 / x; return x; }
function known() { return [Math.max(1, 2), Math.min(1, 2), Math.abs(-3), Math.imul(65537, 65537), Math.round(2.5), Math.round(-2.5), Math.clz32(1), Math.clz32(-1), Math.sign(-7), Math.trunc(-7.5), Math.fround(0.1), Math.sqrt(16), Math.hypot(), Math.hypot(-3)]; }
function knownZeros() { return [1 / Math.round(-0.5), 1 / Math.round(-0.2), 1 / Math.max(0, -0), 1 / Math.min(0, -0), 1 / Math.max(-0, 0), 1 / Math.min(-0, 0), 1 / Math.abs(-0), 1 / Math.sign(-0), 1 / Math.ceil(-0.5), 1 / Math.trunc(-0.5), 1 / Math.sqrt(-0), 1 / Math.fround(-0)]; }
function knownEnds() { return [Math.max(), Math.min(), Math.max(NaN, 1), Math.min(1, NaN), Math.sqrt(-1), Math.abs(NaN), Math.round(NaN), Math.clz32(NaN), Math.clz32(4294967296), Math.imul(4294967295, 5), Math.imul(2.9, 3.9), Math.round(4503599627370495.5), Math.round(0.49999999999999994)]; }
function knownTests() { return [isNaN(NaN), isNaN(1), isFinite(1 / 0), isFinite(1), Number.isNaN(NaN), Number.isFinite(-1 / 0), Number.isInteger(5), Number.isInteger(5.5), Number.isInteger(-0), Number.isSafeInteger(9007199254740991), Number.isSafeInteger(9007199254740992)]; }
function knownTestsOfOthers() { const text = "1"; const nothing = undefined; const none = null; return [isNaN(text), isNaN(nothing), isNaN(none), isFinite(text), isFinite(nothing), Number.isNaN(nothing), Number.isNaN(text), Number.isFinite(text), Number.isInteger(text), Number.isSafeInteger(none)]; }
function parsed() { return [parseInt("ff", 16), parseInt("12px"), parseInt("0x1f"), parseInt(""), parseInt("  -42  "), parseInt("101", 2), parseInt("z", 36), parseInt("9", 8), parseInt("10", 1), parseInt("10", 37), parseInt("10", 0), 1 / parseInt("-0"), Number.parseInt("77", 8), parseInt("123456789012345678901234567890")]; }
function testsOfInteger(a) { if (typeof a !== "number") return "no number"; const v = a | 0; return (Number.isInteger(v) ? 1 : 0) + (Number.isNaN(v) ? 2 : 0) + (isFinite(v) ? 4 : 0) + (isNaN(v) ? 8 : 0) + (Number.isSafeInteger(v) ? 16 : 0) + (Number.isFinite(v) ? 32 : 0); }
function testsOfNumber(a) { if (typeof a !== "number") return "no number"; return (Number.isInteger(a) ? 1 : 0) + (Number.isNaN(a) ? 2 : 0) + (isFinite(a) ? 4 : 0) + (isNaN(a) ? 8 : 0) + (Number.isSafeInteger(a) ? 16 : 0) + (Number.isFinite(a) ? 32 : 0); }
function testsOfAnything(a) { return (Number.isInteger(a) ? 1 : 0) + (Number.isNaN(a) ? 2 : 0) + (Number.isSafeInteger(a) ? 16 : 0) + (Number.isFinite(a) ? 32 : 0); }
function rounded(a) { if (typeof a !== "number") return "no number"; const v = a | 0; return Math.floor(v) + Math.ceil(v) * 2 + Math.trunc(v) * 4 + Math.round(v) * 8; }
function roundedWhole(a) { if (typeof a !== "number") return "no number"; const whole = Math.trunc(a); return tell(Math.floor(whole)); }
function distance(a) { if (typeof a !== "number") return "no number"; const v = a | 0; return Math.abs(v); }
function distanceOfSmall(a) { if (typeof a !== "number") return "no number"; return Math.abs(a & 255); }
function distanceOfNegative(a) { if (typeof a !== "number") return "no number"; return Math.abs(-1 - (a & 255)); }
function distanceOfNoPositive(a) { if (typeof a !== "number") return "no number"; return tell(Math.abs(0 - (a & 255))); }
function distanceTwice(a) { if (typeof a !== "number") return "no number"; return tell(Math.abs(Math.abs(a))); }
function signTwice(a) { if (typeof a !== "number") return "no number"; return tell(Math.sign(Math.sign(a))); }
function signOfBit(a) { if (typeof a !== "number") return "no number"; return Math.sign((a & 2) - 1); }
function atLeastZero(a) { if (typeof a !== "number") return "no number"; return tell(Math.max(a, 0)); }
function atMostZero(a) { if (typeof a !== "number") return "no number"; return tell(Math.min(a, 0)); }
function smallAtLeastZero(a) { if (typeof a !== "number") return "no number"; return Math.max(a & 255, 0); }
function smallAtMost(a) { if (typeof a !== "number") return "no number"; return Math.min(a & 255, 255, 1000); }
function clamped(a) { if (typeof a !== "number") return "no number"; const v = a | 0; return Math.min(Math.max(v, 0), 255); }
function repeated(a) { if (typeof a !== "number") return "no number"; return tell(Math.max(a, a)); }
function amongThree(a) { if (typeof a !== "number") return "no number"; return tell(Math.max(a, a & 15, -1)); }
function withNothing(a) { if (typeof a !== "number") return "no number"; return Math.max(a & 15, NaN); }
function hash(a) { if (typeof a !== "number") return "no number"; return Math.imul(a, 31); }
function hashOfSmall(a) { if (typeof a !== "number") return "no number"; return Math.imul(a & 255, 31); }
function hashOfInteger(a) { if (typeof a !== "number") return "no number"; return Math.imul(a | 0, 65537); }
function timesNone(a) { if (typeof a !== "number") return "no number"; return tell(Math.imul(a, 0)); }
function zeros(a) { if (typeof a !== "number") return "no number"; return Math.clz32(a); }
function zerosOfNegative(a) { if (typeof a !== "number") return "no number"; return Math.clz32(-1 - (a & 255)); }
function zerosOfByte(a) { if (typeof a !== "number") return "no number"; return Math.clz32((a & 127) + 128); }
function single(a) { if (typeof a !== "number") return "no number"; return Math.fround(a & 16777215) + Math.fround((a & 16777215) + 16777216); }
function power(a) { if (typeof a !== "number") return "no number"; return [tell(Math.pow(a, 2)), tell(Math.pow(a, 1)), Math.pow(a, 0), Math.pow(a, -0)].join(); }
function numberOf(a) { try { return tell(Number(a)); } catch (e) { return e.name; } }
function numberOfFlag(a) { return Number(typeof a === "number"); }
function numberOfNumber(a) { if (typeof a !== "number") return "no number"; return tell(Number(a)); }
function numberOfNothing() { const nothing = undefined; const none = null; return [Number(), Number(nothing), Number(none)].join(); }
function truth(a) { return Boolean(a); }
function textOf(a) { if (typeof a !== "string") return "no text"; return String(a); }
function ofNone() { return [String(), Boolean()].join("|"); }
function objectOf(a) { if (typeof a !== "object" || a === null) return "no object"; return Object(a) === a; }
function underAnotherName(a) { if (typeof a !== "number") return "no number"; const floor = Math.floor; const v = a | 0; return floor(v / 4); }
function ofLocal(a) { if (typeof a !== "number") return "no number"; const Math = { floor(x) { return x + 0.25; }, max(x, y) { return x - y; } }; const v = a | 0; return Math.floor(v / 4) + Math.max(v & 255, 0); }
let log = "";
const converts = { valueOf() { log += "v"; return 5.5; } };
report(known().join());
report(knownZeros().join());
report(knownEnds().join());
report(knownTests().join());
report(knownTestsOfOthers().join());
report(parsed().join());
report(numberOfNothing());
report(ofNone());
const values = [0, -0, 1, -1, 2, 3, 127, 128, 255, 256, 2147483647, -2147483648, 2147483648, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1000000000000000000000, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000, 1.5, -1.5, 0.5, -0.5, 2.5, -2.5, NaN, 1 / 0, -1 / 0, "3", "", " 1 ", "x", null, undefined, true, false, converts, [], [7], {}];
for (let i = 0;i < values.length; i++) { const x = values[i]; report(testsOfInteger(x)); report(testsOfNumber(x)); report(testsOfAnything(x)); report(rounded(x)); report(roundedWhole(x)); report(distance(x)); report(distanceOfSmall(x)); report(distanceOfNegative(x)); report(distanceOfNoPositive(x)); report(distanceTwice(x)); report(signTwice(x)); report(signOfBit(x)); }
for (let i = 0;i < values.length; i++) { const x = values[i]; report(atLeastZero(x)); report(atMostZero(x)); report(smallAtLeastZero(x)); report(smallAtMost(x)); report(clamped(x)); report(repeated(x)); report(amongThree(x)); report(withNothing(x)); report(hash(x)); report(hashOfSmall(x)); report(hashOfInteger(x)); report(timesNone(x)); }
for (let i = 0;i < values.length; i++) { const x = values[i]; report(zeros(x)); report(zerosOfNegative(x)); report(zerosOfByte(x)); report(single(x)); report(power(x)); report(numberOf(x)); report(numberOfFlag(x)); report(numberOfNumber(x)); report(truth(x)); report(textOf(x)); report(objectOf(x)); report(underAnotherName(x)); report(ofLocal(x)); }
report(numberOf(12n));
report(numberOf(Symbol("s")));
report(truth(0n));
report(log);
report("end");
