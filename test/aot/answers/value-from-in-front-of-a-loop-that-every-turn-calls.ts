// answers: without-library
// # where the code of a value lies is asked once in front of the loop that calls it: an arrow, a function, too few and too many parameters, a built-in, a bound function, a proxy, a class, and what cannot be called: that throws in the first turn, behind its arguments, and not without a turn
// # f1 = each, f2 = withThis, f3 = manyArguments, f4 = noArguments, f5 = argumentsFirst, f6 = tell
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = ResolveCallTarget
// # FORM: = CallResolved
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function each(cb: any, n: number) { for (let i = 0; i < n; i++) cb(i); return log; }
function withThis(cb: any, self: unknown, n: number) { let s = ""; for (let i = 0; i < n; i++) s += cb.call(self, i); return s; }
function manyArguments(cb: any, n: number) { let s = 0; for (let i = 0; i < n; i++) s += cb(i, 1, 2, 3, 4, 5, 6, 7, 8, 9); return s; }
function noArguments(cb: any, n: number) { let s = 0; for (let i = 0; i < n; i++) s += cb(); return s; }
function argumentsFirst(cb: any, n: number) { for (let i = 0; i < n; i++) cb(log = log + "a"); return log; }
class Made { constructor() { log = log + "made"; } }
function tell(f: () => unknown) { log = ""; try { report(f()); } catch (e) { report((e as Error).name + log); } }
tell(() => each((i: number) => { log = log + i; }, 3));
tell(() => each(function (this: unknown, i: number) { log = log + typeof this + i; }, 2));
tell(() => each((a: number, b: unknown) => { log = log + a + String(b); }, 2));
tell(() => each(Math.abs, 2));
tell(() => each(((i: number) => { log = log + "b" + i; }).bind(null), 2));
tell(() => each(new Proxy((i: number) => { log = log + "p" + i; }, {}), 2));
tell(() => each(undefined, 0));
tell(() => each(undefined, 2));
tell(() => each({}, 1));
tell(() => each(Made, 1));
tell(() => argumentsFirst(5, 2));
tell(() => manyArguments((...all: number[]) => all.length, 2));
tell(() => noArguments((a: unknown) => (a === undefined ? 1 : 0), 3));
tell(() => withThis(function (this: unknown, i: number) { return String(this) + i; }, "s", 2));
report("end");
