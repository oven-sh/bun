// answers: without-library
// # remainders of proven integers where -0 cannot be told from 0, and where it can: compared, tested, added, cut and used as keys, with divisors of zero, which leave NaN, and with dividends at the ends of int32. And remainders of plain numbers that are only tested, on integers beyond 2 ** 53, fractions, -0, NaN and the infinities
// # f1 = third, f2 = fourth, f3 = oneOverFour, f4 = minusOneOverFour, f5 = overMinusFour, f6 = tooFar, f7 = odd, f8 = notThird, f9 = byAny, f10 = byAnyIsOne, f11 = byAnyLoosely, f12 = truthByAny, f13 = same, f14 = below, f15 = atLeast, f16 = left, f17 = beside, f18 = under, f19 = minuend, f20 = bits, f21 = ring, f22 = store, f23 = ofNumber, f24 = truthOfNumber, f25 = ofNumberIsThree
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = RemainderOfIntegers
// # RUN(ZERO): walk f9 mechanisms=all
// # ZERO-LABEL: code f9:Body
// # ZERO: = RemainderOfIntegers
// # ZERO: frequency=Rare
// # behind `typeof y !== "number"` the front end goes on writing the value that was tested, of which the walk knows no more than in front of the test. So the dividend is `+y`, which the row of the conversion proves a number
// # RUN(NUMBER): walk f25 mechanisms=all
// # NUMBER-LABEL: code f25:Body
// # NUMBER: frequency=Unlikely
// # NUMBER: = Mod
// # NUMBER: = RemainderOfIntegers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9451 of 9451 of 9451
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function third(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return x % 3 === 0; }
function fourth(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return x % 4 === 0; }
function oneOverFour(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return x % 4 === 1; }
function minusOneOverFour(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return -1 === x % 4; }
function overMinusFour(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return x % -4 === 3; }
function tooFar(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return x % 4 === 4; }
function odd(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return x % 2 ? "odd" : "even"; }
function notThird(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return !(x % 3); }
function byAny(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return x % d === 0; }
function byAnyIsOne(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return x % d === 1; }
function byAnyLoosely(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return x % d == 0; }
function truthByAny(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return x % d ? "left" : "nothing"; }
function same(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return x % d === d % x; }
function below(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return x % d < 2; }
function atLeast(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return 0 <= x % d; }
function left(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return 1 / (x % 3); }
function beside(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return 1 / ((x % 3) + (x & 1)); }
function under(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return 1 / ((x & 1) - (x % 3)); }
function minuend(a: unknown) { if (typeof a !== "number") return "no number"; const x = a | 0; return 1 / ((x % 3) - (x & 1)); }
function bits(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return (x % d) | 0; }
function ring(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const list = ["zero", "one", "two"]; const x = a | 0; const d = b | 0; return list[x % d]; }
function store(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const list: any = [0, 0, 0]; const x = a | 0; const d = b | 0; list[x % d] = 7; return list[0] * 100 + list[1] * 10 + list[2] + (list.NaN === 7 ? 1000 : 0); }
function ofNumber(y: unknown) { if (typeof y !== "number") return "no number"; const n = +y; return n % 4 === 0; }
function truthOfNumber(y: unknown) { if (typeof y !== "number") return "no number"; const n = +y; if (n % 2) return "left"; return "nothing"; }
function ofNumberIsThree(y: unknown) { if (typeof y !== "number") return "no number"; const n = +y; return n % 5 === 3; }
const values: unknown[] = [0, -0, 1, -1, 2, -2, 3, -3, 4, -4, 5, 7, -7, 8, 2147483647, -2147483648, 2147483648, 9007199254740992, -9007199254740994, 1e300, 1.5, -0.5, 4.000001, NaN, Infinity, -Infinity, "4", null, undefined, true];
for (let i = 0; i < values.length; i++) { report(third(values[i])); report(fourth(values[i])); report(oneOverFour(values[i])); report(minusOneOverFour(values[i])); report(overMinusFour(values[i])); report(tooFar(values[i])); report(odd(values[i])); report(notThird(values[i])); }
for (let i = 0; i < values.length; i++) { report(left(values[i])); report(beside(values[i])); report(under(values[i])); report(minuend(values[i])); report(ofNumber(values[i])); report(truthOfNumber(values[i])); report(ofNumberIsThree(values[i])); }
for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) { report(byAny(values[i], values[j])); report(byAnyIsOne(values[i], values[j])); report(byAnyLoosely(values[i], values[j])); report(truthByAny(values[i], values[j])); report(same(values[i], values[j])); }
for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) { report(below(values[i], values[j])); report(atLeast(values[i], values[j])); report(bits(values[i], values[j])); report(ring(values[i], values[j])); report(store(values[i], values[j])); }
report("end");
