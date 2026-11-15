// answers: without-library
// # operators beside their identity elements, two negations, and bit operators on proven numbers: on -0, which 1 / x tells from 0, NaN, the infinities, the ends of int32 and of the exact integers, shifts by 32, 33 and -1, and on what is no number
// # behind `typeof x !== "number"` the front end goes on writing the value that was tested, of which the walk knows no more than in front of the test. So each function takes `+x`, which the row of the conversion proves a number
// # f1 = tell, f2 = timesOne, f3 = oneTimes, f4 = overOne, f5 = minusZero, f6 = plusZero, f7 = plusNegativeZero, f8 = minusNegativeZero, f9 = integerPlusZero, f10 = integerMinusNegativeZero, f11 = toTheFirst, f12 = toTheZeroth, f13 = squared, f14 = distance, f15 = farDistance, f16 = distanceOfNumber, f17 = timesOneOfAnything, f18 = twice, f19 = twiceOfAnything, f20 = orZero, f21 = zeroOr, f22 = xorZero, f23 = andAll, f24 = andNone, f25 = shiftByNone, f26 = shiftBy32, f27 = shiftBy33, f28 = shiftByMinusOne, f29 = noneShifted, f30 = unsigned, f31 = unsignedOfInteger, f32 = invertedTwice, f33 = truncated, f34 = floored, f35 = product, f36 = masked, f37 = orZeroOfAnything
// # RUN(FORM): walk f2 mechanisms=all
// # FORM-NOT: = Mul
// # RUN(STAYS): walk f6 mechanisms=all
// # STAYS-LABEL: code f6:Body
// # STAYS: = Add {{*}}form=Numbers
// # RUN(BITS): walk f20 mechanisms=all
// # BITS-LABEL: code f20:Body
// # BITS: = ToInt32
// # RUN(UNSIGNED): walk f30 mechanisms=all
// # UNSIGNED-LABEL: code f30:Body
// # UNSIGNED: = ToUint32
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 1228 of 1228 of 1228
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function tell(x: unknown) { if (typeof x === "number" && x === 0) return 1 / x; return x; }
function timesOne(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(n * 1); }
function oneTimes(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(1 * n); }
function overOne(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(n / 1); }
function minusZero(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(n - 0); }
function plusZero(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(n + 0); }
function plusNegativeZero(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(n + -0); }
function minusNegativeZero(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(n - -0); }
function integerPlusZero(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell((n | 0) + 0); }
function integerMinusNegativeZero(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell((n | 0) - -0); }
function toTheFirst(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(n ** 1); }
function toTheZeroth(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(n ** 0); }
function squared(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return tell(n ** 2); }
function distance(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; const v = n | 0; return (v + 8) - v; }
function farDistance(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; const v = n | 0; return (v + 2147483647) - v; }
function distanceOfNumber(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return (n + 8) - n; }
function timesOneOfAnything(x: any) { try { return tell(x * 1); } catch (e) { return (e as Error).name; } }
function twice(x: unknown) { return !!(typeof x === "number"); }
function twiceOfAnything(x: unknown) { return !!x; }
function orZero(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return n | 0; }
function zeroOr(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return 0 | n; }
function xorZero(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return n ^ 0; }
function andAll(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return n & -1; }
function andNone(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return n & 0; }
function shiftByNone(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return n << 0; }
function shiftBy32(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return n >> 32; }
function shiftBy33(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return n >> 33; }
function shiftByMinusOne(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return n << -1; }
function noneShifted(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return 0 << n; }
function unsigned(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return n >>> 0; }
function unsignedOfInteger(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return (n | 0) >>> 0; }
function invertedTwice(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return ~~n; }
function truncated(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return Math.trunc(n) | 0; }
function floored(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; return Math.floor(n) | 0; }
function product(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; const v = n | 0; return (v * v) | 0; }
function masked(x: unknown) { if (typeof x !== "number") return "no number"; const n = +x; const h = n * 0.5; let s = 0; for (let i = 0; i < 3; i++) s = s + (h & 255) + (h & 4095) + (h | 0); return s; }
function orZeroOfAnything(x: any) { try { return x | 0; } catch (e) { return (e as Error).name; } }
let log = "";
const converts = { valueOf() { log += "v"; return 5.5; } };
const values: unknown[] = [0, -0, 1, -1, 2, 255, 256, 2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e21, -1e21, 1e300, 1.5, -1.5, 0.5, -0.5, NaN, Infinity, -Infinity, "3", "", " 1 ", "x", null, undefined, true, false, converts];
for (let i = 0; i < values.length; i++) { const x = values[i]; report(timesOne(x)); report(oneTimes(x)); report(overOne(x)); report(minusZero(x)); report(plusZero(x)); report(plusNegativeZero(x)); report(minusNegativeZero(x)); report(integerPlusZero(x)); report(integerMinusNegativeZero(x)); }
for (let i = 0; i < values.length; i++) { const x = values[i]; report(toTheFirst(x)); report(toTheZeroth(x)); report(squared(x)); report(distance(x)); report(farDistance(x)); report(distanceOfNumber(x)); report(timesOneOfAnything(x)); report(twice(x)); report(twiceOfAnything(x)); }
for (let i = 0; i < values.length; i++) { const x = values[i]; report(orZero(x)); report(zeroOr(x)); report(xorZero(x)); report(andAll(x)); report(andNone(x)); report(shiftByNone(x)); report(shiftBy32(x)); report(shiftBy33(x)); report(shiftByMinusOne(x)); report(noneShifted(x)); }
for (let i = 0; i < values.length; i++) { const x = values[i]; report(unsigned(x)); report(unsignedOfInteger(x)); report(invertedTwice(x)); report(truncated(x)); report(floored(x)); report(product(x)); report(masked(x)); report(orZeroOfAnything(x)); }
report(timesOneOfAnything(10n));
report(orZeroOfAnything(10n));
report(log);
report("end");
