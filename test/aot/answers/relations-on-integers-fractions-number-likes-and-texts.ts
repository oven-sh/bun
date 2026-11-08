// answers: without-library
// # relations of a proven integer with a fraction, NaN, an infinity and -0, with a number that is rounded in front of a loop, of booleans, undefined and null with numbers, and loose equality with a text that is no number: on objects that convert, in their order, and that throw
// # f1 = below, f2 = atMost, f3 = above, f4 = atLeast, f5 = fractionBelow, f6 = fractionAtLeast, f7 = belowNothing, f8 = atLeastNothing, f9 = belowAll, f10 = aboveAll, f11 = belowNegativeZero, f12 = atLeastNegativeZero, f13 = narrowed, f14 = count, f15 = countDown, f16 = countUpTo, f17 = flagBelow, f18 = belowFlag, f19 = besideNothing, f20 = flags, f21 = isWord, f22 = wordIs, f23 = isTwelve, f24 = isEmpty, f25 = isNotANumber, f26 = isEndless
// # RUN(BOUND): walk f14 mechanisms=all
// # BOUND-LABEL: code f14:Body
// # BOUND: = IntegerBound
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 694 of 694 of 694
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function below(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v < 2.5; }
function atMost(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v <= 2.5; }
function above(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v > -2.5; }
function atLeast(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v >= -2.5; }
function fractionBelow(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return 2.5 < v; }
function fractionAtLeast(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return -0.5 >= v; }
function belowNothing(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v < NaN; }
function atLeastNothing(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v >= NaN; }
function belowAll(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v < Infinity; }
function aboveAll(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v > 1e300; }
function belowNegativeZero(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v < -0; }
function atLeastNegativeZero(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; return v >= -0; }
function narrowed(a: unknown) { if (typeof a !== "number") return "no number"; const v = a | 0; if (v < 2.5 && v > -1.5) return ["minus one", "zero", "one", "two"][v + 1]; return "outside"; }
function count(x: unknown) { if (typeof x !== "number") return "no number"; const n = x / 2; let i = 0; while (i < n && i < 50) i = (i + 1) | 0; return i; }
function countDown(x: unknown) { if (typeof x !== "number") return "no number"; const n = x / 2; let i = 20; while (n <= i && i > -20) i = (i - 1) | 0; return i; }
function countUpTo(x: unknown) { if (typeof x !== "number") return "no number"; const n = x / 2; let i = 0; while (i <= n && i < 50) i = (i + 1) | 0; return i; }
function flagBelow(x: unknown, n: unknown) { if (typeof n !== "number") return "no number"; const m = +n; const flag: any = typeof x === "number"; return flag < m; }
function belowFlag(x: unknown, n: unknown) { if (typeof n !== "number") return "no number"; const m = +n; const flag: any = typeof x === "number"; return m <= flag; }
function besideNothing(n: unknown) { if (typeof n !== "number") return "no number"; const m = +n; const nothing: any = undefined; const none: any = null; return (m < nothing ? 1 : 0) + (m >= none ? 2 : 0) + (none <= m ? 4 : 0); }
function flags(x: unknown, y: unknown) { const a: any = typeof x === "number"; const b: any = typeof y === "number"; return a < b; }
function isWord(x: any) { return x == "abc"; }
function wordIs(x: any) { return "abc" == x; }
function isTwelve(x: any) { return x == "12"; }
function isEmpty(x: any) { return x == ""; }
function isNotANumber(x: any) { return x == "NaN"; }
function isEndless(x: any) { return x == "Infinity"; }
let log = "";
const word = { toString() { log += "s"; return "abc"; } };
const wordByValue = { valueOf() { log += "v"; return "abc"; }, toString() { log += "!"; return "no"; } };
const thrower = { valueOf() { log += "t"; throw new RangeError("thrown"); } };
const rope = "a" + ["b", "x"][0] + "c";
const numbers: unknown[] = [0, -0, 1, -1, 2, 3, -2, -3, 2.5, -2.5, 2147483647, -2147483648, 2147483648, 40.5, 41, 1e300, -1e300, NaN, Infinity, -Infinity, "2", null, undefined, true];
for (let i = 0; i < numbers.length; i++) { const x = numbers[i]; report(below(x)); report(atMost(x)); report(above(x)); report(atLeast(x)); report(fractionBelow(x)); report(fractionAtLeast(x)); report(belowNothing(x)); report(atLeastNothing(x)); report(belowAll(x)); report(aboveAll(x)); report(belowNegativeZero(x)); report(atLeastNegativeZero(x)); report(narrowed(x)); }
for (let i = 0; i < numbers.length; i++) { const x = numbers[i]; report(count(x)); report(countDown(x)); report(countUpTo(x)); report(besideNothing(x)); report(flagBelow(1, x)); report(flagBelow("1", x)); report(belowFlag(1, x)); report(belowFlag("1", x)); report(flags(x, 1)); report(flags(x, "1")); }
const others: unknown[] = ["abc", "ab", rope, "12", 12, "", 0, -0, false, true, null, undefined, NaN, "NaN", Infinity, "Infinity", 12n, word, wordByValue, ["abc"], [12], [], {}];
for (let i = 0; i < others.length; i++) { const x = others[i]; report(isWord(x)); report(wordIs(x)); report(isTwelve(x)); report(isEmpty(x)); report(isNotANumber(x)); report(isEndless(x)); }
try { report(isWord(thrower)); } catch (e) { report((e as Error).message); }
try { report(isWord(Symbol("abc"))); } catch (e) { report((e as Error).name); }
report(log);
report("end");
