// answers: without-library
// # numbers that the program has tested, and what a closed call of Number gives, arrive boxed. A chain walked on integers and on doubles, a sum that stays boxed and a truncation that reads the tag give what the operators as written give:
// # at the ends of int32, past 2 ** 53, for -0, NaN, the infinities and fractions, each beside each
// # the forms behind `typeof a === "number"` (f1 to f10) are asked for in ../walk/unboxed-numbers/numbers-that-the-program-has-tested-arrive-boxed-from-source.ir, which waits for narrowing on edges
// # with built-in calls withheld the call of Number stays a call, and with copies withheld the bodies that are shown here are the bodies that run
// # f1 = mix, f2 = chain, f3 = sum, f4 = less, f5 = step, f6 = whole, f7 = unsigned, f8 = flipped, f9 = wrap, f10 = scaled, f11 = total, f12 = gap, f13 = half, f14 = area
// # RUN(BOXED): walk f11 mechanisms=all-BuiltinCalls-Inlining
// # BOXED-LABEL: code f11:Body
// # BOXED: @JSValue = Add {{*}}form=Numbers
// # RUN(GAP): walk f12 mechanisms=all-BuiltinCalls-Inlining
// # GAP-LABEL: code f12:Body
// # GAP: @JSValue = Sub {{*}}form=Numbers
// # RUN(RAW): walk f13 mechanisms=all-BuiltinCalls-Inlining
// # RAW-LABEL: code f13:Body
// # RAW: @Double = Add {{*}}form=Numbers
// # RUN(PRODUCT): walk f14 mechanisms=all-BuiltinCalls-Inlining
// # PRODUCT-LABEL: code f14:Body
// # PRODUCT: @Double = Add {{*}}form=Numbers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4496 of 4496 of 4496
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-BuiltinCalls-Inlining $SHELL
// # ALSO1: 4496 of 4496 of 4496
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-Guesses-LoopInvariants $SHELL
// # ALSO2: 4496 of 4496 of 4496
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-UnboxedNumbers-TypedSlots $SHELL
// # ALSO3: 4496 of 4496 of 4496
// # ALSO3-NEXT: exited with 0
function mix(a: any, b: any) { if (typeof a === "number" && typeof b === "number") return (a + b) | 0; return "no numbers"; }
function chain(a: any, b: any, c: any) { if (typeof a === "number" && typeof b === "number" && typeof c === "number") return ((a + b) * c - a) >>> 0; return "no numbers"; }
function sum(a: any, b: any) { if (typeof a === "number" && typeof b === "number") return a + b; return "no numbers"; }
function less(a: any, b: any) { if (typeof a === "number" && typeof b === "number") return a - b; return "no numbers"; }
function step(a: any) { if (typeof a === "number") { a++; return a; } return "no number"; }
function whole(a: any) { if (typeof a === "number") return a | 0; return "no number"; }
function unsigned(a: any) { if (typeof a === "number") return a >>> 0; return "no number"; }
function flipped(a: any) { if (typeof a === "number") return 0 ^ a; return "no number"; }
function wrap(x: any, y: any) { if (typeof x === "number" && typeof y === "number") { let s = 0; for (let i = 0; i < 3; i++) s += x % y; return s; } return "no numbers"; }
function scaled(a: any, b: any) { if (typeof a === "number" && typeof b === "number") return a * 0.5 + b; return "no numbers"; }
function total(a: any, b: any) { if (b === "none") return "none"; return Number(a) + Number(b); }
function gap(a: any, b: any) { if (b === "none") return "none"; return Number(a) - Number(b); }
function half(a: any, b: any) { if (b === "none") return "none"; return Number(a) * 0.5 + Number(b); }
function area(a: any, b: any) { if (b === "none") return "none"; const x = Number(a); return (x + Number(b)) * x; }
function show(value: unknown) { return typeof value === "number" && value === 0 ? (1 / value > 0 ? "0" : "-0") : value; }
function tell(f: () => unknown) { try { report(show(f())); } catch (e) { report((e as Error).name); } }
const numbers = JSON.parse("[0, -0, 1, -1, 7, 0.5, -0.5, 2147483647, -2147483648, 2147483648, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e21, 1e300, -1e300]");
numbers[numbers.length] = NaN;
numbers[numbers.length] = Infinity;
numbers[numbers.length] = -Infinity;
numbers[numbers.length] = "3";
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => mix(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => chain(numbers[i], numbers[j], numbers[(i + j) % numbers.length]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => sum(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => less(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => wrap(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => scaled(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => total(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => gap(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => half(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => area(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) tell(() => step(numbers[i]));
for (let i = 0; i < numbers.length; i++) tell(() => whole(numbers[i]));
for (let i = 0; i < numbers.length; i++) tell(() => unsigned(numbers[i]));
for (let i = 0; i < numbers.length; i++) tell(() => flipped(numbers[i]));
tell(() => total(1, "none"));
report("end");
