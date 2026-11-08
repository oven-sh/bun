// answers: without-library
// # ten small functions stand below one another and the lowest eight make no stack test. A recursion that is no tail call, of one function and of a ring of two, still ends in a RangeError that is caught, and the program goes on
// # f1 = d1 .. f10 = d10, f11 = deep, f12 = endless, f13 = ping, f14 = pong, f15 = counts, f16 = tell
// # RUN(FORM): plan units mechanisms=all-Inlining
// # FORM: unit f1:Body {{*}}covered-by-callers
// # FORM: unit f8:Body {{*}}covered-by-callers
// # RUN(TESTS): plan units mechanisms=all-Inlining
// # TESTS-NOT: unit f12:Body {{*}}covered-by-callers
// # TESTS-NOT: unit f13:Body {{*}}covered-by-callers
// # TESTS-NOT: unit f15:Body {{*}}covered-by-callers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function d1(v: number): number { return v + 1; }
function d2(v: number): number { return d1(v) * 2; }
function d3(v: number): number { return d2(v) + 3; }
function d4(v: number): number { return d3(v) * 2; }
function d5(v: number): number { return d4(v) + 5; }
function d6(v: number): number { return d5(v) * 2; }
function d7(v: number): number { return d6(v) + 7; }
function d8(v: number): number { return d7(v) * 2; }
function d9(v: number): number { return d8(v) + 9; }
function d10(v: number): number { return d9(v) * 2; }
function deep(n: number): number { return n === 0 ? d10(1) : deep(n - 1) + 1; }
function endless(n: number): number { return endless(n + 1) + d10(n); }
function ping(n: number): number { return pong(n + 1) + d10(n); }
function pong(n: number): number { return ping(n + 1) + d5(n); }
let turns = 0;
function counts(n: number): number { turns++; return counts(n + 1) + d10(n); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => d10(1));
tell(() => deep(100));
tell(() => endless(0));
tell(() => d10(2));
tell(() => ping(0));
tell(() => deep(50) + d10(3));
tell(() => counts(0));
tell(() => turns > 100);
tell(() => d10("a" as any));
report("end");
