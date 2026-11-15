// answers: without-library
// # an operation that is written twice is built once, and a branch that a branch on the way has decided is a jump: the answers are those of the text for numbers, NaN, -0, texts, and operands that convert and count
// # behind its tests each function takes its numbers through a unary plus. What that gives is a number by its own row, whatever the walk makes of the tests: the front end reads the parameter itself behind a test, which no edge narrows
// # f1 = twice, f2 = converts, f3 = again, f4 = reversed, f5 = turns, f6 = texts, f7 = truth, f8 = signs, f9 = sides, f10 = negated, f11 = tell
// # RUN(FORM): walk f1 mechanisms=none+Folding+TypedOperations
// # FORM-LABEL: code f1:Body
// # FORM: = Mul {{*}}form=Numbers
// # FORM-NOT: = Mul
// # RUN(JUMP): walk f3 mechanisms=none+Folding+TypedOperations
// # JUMP-LABEL: code f3:Body
// # JUMP: = Less {{*}}form=Numbers
// # JUMP-NOT: = Less
// # RUN(TRUTH): walk f10 mechanisms=none+Folding
// # TRUTH-LABEL: code f10:Body
// # TRUTH: = ToBoolean
// # TRUTH-NOT: = ToBoolean
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 41 of 41 of 41
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none+Folding $SHELL
// # ALSO1: 41 of 41 of 41
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=none+Folding+TypedOperations $SHELL
// # ALSO2: 41 of 41 of 41
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO3: 41 of 41 of 41
// # ALSO3-NEXT: exited with 0
declare function report(value: unknown): void;
let conversions = 0;
const counting = { valueOf() { conversions = conversions + 1; return 3; } };
function twice(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no numbers"; const x = +a; const y = +b; return x * y + y * x; }
function converts(a: any, b: any) { return a * b + b * a; }
function again(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return 0; const x = +a; const y = +b; if (x < y) { if (x < y) return 1; return 2; } return 3; }
function reversed(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return 0; const x = +a; const y = +b; if (x < y) return 1; if (x >= y) return 2; return 3; }
function turns(a: unknown, b: unknown, n: number) { if (typeof a !== "number" || typeof b !== "number") return 0; let x = +a; const y = +b; let total = 0; for (let i = 0; i < n; i++) { if (x < y) total += 1; if (x < y) total += 10; else total += 100; x = x + 1; } return total; }
function texts(a: unknown, b: unknown) { if (typeof a !== "string" || typeof b !== "string") return 0; let total = 0; if (a === b) total += 1; if (b === a) total += 10; if (a === b) total += 100; return total; }
function truth(x: unknown) { let total = 0; if (x) total += 1; if (x) total += 10; if (!x) total += 100; return total; }
function signs(a: unknown, b: unknown) { if (typeof a !== "number" || typeof b !== "number") return "no numbers"; const x = +a; const y = +b; return String(1 / (x * y)) + String(1 / (y * x)) + String(x - y) + String(y - x); }
function sides(a: unknown, b: unknown, c: boolean) { if (typeof a !== "number" || typeof b !== "number") return 0; const x = +a; const y = +b; let total = 0; if (c) { if (x < y) total += 1; } else { if (x < y) total += 10; } if (x < y) total += 100; return total; }
function negated(x: unknown) { if (!x) { if (x) return 1; return 2; } if (x) return 3; return 4; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => twice(3, 4));
tell(() => twice(0.5, NaN));
tell(() => twice("3", 4));
tell(() => converts(counting, 2));
tell(() => conversions);
tell(() => converts(counting, counting));
tell(() => conversions);
tell(() => converts(2n, 3));
tell(() => again(1, 2));
tell(() => again(2, 1));
tell(() => again(NaN, 1));
tell(() => again(-0, 0));
tell(() => reversed(1, 2));
tell(() => reversed(2, 1));
tell(() => reversed(2, 2));
tell(() => reversed(NaN, 2));
tell(() => reversed(2, NaN));
tell(() => turns(0, 2, 4));
tell(() => turns(NaN, 2, 3));
tell(() => turns(5, 2, 0));
tell(() => texts("ab", "ab"));
tell(() => texts("ab", "a" + String.fromCharCode(98)));
tell(() => texts("ab", "ac"));
tell(() => truth(0));
tell(() => truth(-0));
tell(() => truth(NaN));
tell(() => truth(""));
tell(() => truth("0"));
tell(() => truth(counting));
tell(() => truth(null));
tell(() => signs(0, -1));
tell(() => signs(-0, -0));
tell(() => sides(1, 2, true));
tell(() => sides(1, 2, false));
tell(() => sides(2, 1, true));
tell(() => sides(NaN, NaN, false));
tell(() => negated(0));
tell(() => negated(1));
tell(() => negated(""));
tell(() => negated(counting));
report("end");
