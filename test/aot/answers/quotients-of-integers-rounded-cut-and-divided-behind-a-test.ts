// answers: without-library
// # quotients of proven integers that a function of Math rounds, a bit operator cuts, or a test of the remainder stands in front of: at the ends of int32, by zero, by negative divisors, and wherever -0 comes of it, which 1 / x tells from 0
// # f1 = down, f2 = up, f3 = upOfAny, f4 = cutOfAny, f5 = nearest, f6 = nearestOfAny, f7 = belowZero, f8 = byAny, f9 = cut, f10 = shifted, f11 = cutTwice, f12 = whole, f13 = wholeByTruth, f14 = broken, f15 = halve, f16 = halveUp
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = DivideIntegers
// # RUN(CUT): walk f9 mechanisms=all
// # CUT-LABEL: code f9:Body
// # CUT: = DivideIntegers {{*}}rounding=ToInt32
// # RUN(WHOLE): walk f12 mechanisms=all
// # WHOLE-LABEL: code f12:Body
// # WHOLE: = DivideIntegers {{*}}rounding=ToInt32
// # RUN(LOOP): walk f15 mechanisms=all
// # LOOP-LABEL: code f15:Body
// # LOOP: = DivideIntegers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7453 of 7453 of 7453
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function down(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = (b & 7) + 1; return Math.floor(x / d); }
function up(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a & 255; const d = (b & 7) + 1; return Math.ceil(x / d); }
function upOfAny(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = (b & 7) + 1; return 1 / Math.ceil(x / d); }
function cutOfAny(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = (b & 7) + 1; return 1 / Math.trunc(x / d); }
function nearest(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a & 1023; const d = (b & 7) + 1; return Math.round(x / d); }
function nearestOfAny(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = (b & 7) + 1; return 1 / Math.round(x / d); }
function belowZero(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a & 255; const d = -1 - (b & 7); return 1 / Math.floor(x / d); }
function byAny(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return Math.floor(x / d); }
function cut(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return (x / d) | 0; }
function shifted(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return (x / d) >>> 1; }
function cutTwice(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = b | 0; return ~~Math.trunc(x / d); }
function whole(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = (b & 7) + 1; if (x % d === 0) return 1 / (x / d); return "something is left"; }
function wholeByTruth(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = (b & 7) + 1; if (x % d) return "something is left"; return 1 / (x / d); }
function broken(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no number"; const x = a | 0; const d = (b & 7) + 1; if (x % d === 0) return "nothing is left"; return x / d; }
function halve(a: unknown) { if (typeof a !== "number") return "no number"; let i = a | 0; let turns = 0; while (i > 0) { i = Math.floor(i / 2); turns++; } return turns * 1000 + i; }
function halveUp(a: unknown) { if (typeof a !== "number") return "no number"; let i = a | 0; let turns = 0; while (i < -1 && turns < 40) { i = Math.floor(i / 2); turns++; } return turns * 1000 + i; }
const values: unknown[] = [0, -0, 1, -1, 2, 3, 7, -7, 8, 255, 2147483647, -2147483648, 2147483648, 4294967295, 1.5, -0.5, NaN, Infinity, -Infinity, "3", null, undefined, true];
for (let i = 0; i < values.length; i++) { report(halve(values[i])); report(halveUp(values[i])); }
for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) { report(down(values[i], values[j])); report(up(values[i], values[j])); report(upOfAny(values[i], values[j])); report(cutOfAny(values[i], values[j])); }
for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) { report(nearest(values[i], values[j])); report(nearestOfAny(values[i], values[j])); report(belowZero(values[i], values[j])); report(byAny(values[i], values[j])); }
for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) { report(cut(values[i], values[j])); report(shifted(values[i], values[j])); report(cutTwice(values[i], values[j])); }
for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) { report(whole(values[i], values[j])); report(wholeByTruth(values[i], values[j])); report(broken(values[i], values[j])); }
report("end");
