// answers: with-library
// # Array.from takes what it ever took: an iterable, an array-like, null, a callback whose stores are read again behind the call, another `this`
// # the made file holds no function of the library, so the engine's own functions run and no run here shows a direct call. That form stands in walk/builtin-calls/built-in-whose-rows-name-a-library-function-is-called-directly.ir
// # f1 = list, f2 = mapped, f3 = under, f4 = tell
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function list(from: any) { return Array.from(from).join(); }
function mapped(from: any, f: (v: any) => unknown) { const before = log; const made = Array.from(from, f); return before + "|" + log + "|" + made.join(); } // @ts-expect-error
function under(self: any, from: any) { const made = Array.from.call(self, from); return String(Array.isArray(made)) + String(made.length); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => list([1, 2, 3]));
tell(() => list("ab"));
tell(() => list({ length: 2, 0: "x", 1: "y" }));
tell(() => list(null));
tell(() => mapped([1, 2], v => { log = log + v; return v * 2; }));
tell(() => mapped([1, 2], v => { throw new RangeError("stop"); }));
tell(() => mapped([1], 5 as any));
tell(() => under(undefined, [1, 2]));
tell(() => under(function (this: any, n: number) { this.length = 0; }, [1, 2]));
report("end");
