// answers: without-library
// # what the front end writes for a `for of` over a generator that a variable or a parameter holds too: the ramp makes and starts it, the open asks once or not at all, and the generator is the state of the iteration
// # f1 = count, f2 = total, f3 = restOf, f4 = twice
// # LIBRARY: own
// # RUN(FORM): walk f3 mechanisms=all
// # FORM: = StepGenerator {{*}}check=None
// # RUN(NEVER): walk f3 mechanisms=all
// # NEVER-NOT: NewHeapWords
// # RUN(READS): walk f3 mechanisms=all
// # READS: InitializeBuiltin builtin=GeneratorPrototypeNext
// # RUN(WRITTEN): walk f2 mechanisms=all-ParameterGuards-Inlining
// # WRITTEN: = TypeTest {{*}}testedType=Generator
// # WRITTEN: = IsUnmodifiedGenerator
// # RUN(STEP): walk f2 mechanisms=all-ParameterGuards-Inlining
// # STEP: = StepGenerator {{*}}check=None
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 14 of 14 of 14
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function* count(n: number) { try { for (let i = 0; i < n; i++) yield i; } finally { log += "f;"; } }
function total(things: Generator<number>) { let t = 0; for (const x of things) t += x; return t; }
function restOf(n: number) { const things = count(n); things.next(); let t = 0; for (const x of things) t += x; return t; }
function twice(n: number) { const things = count(n); let t = 0; for (const x of things) { t += x; if (x === 1) break; } for (const x of things) t += 100 + x; return t; }
function steppedInTurns(n: number) { const things = count(n); let t = 0; for (const x of things) { t += x; things.next(); } return t; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name + ":" + log); } }
tell(() => total(count(4)));
for (let i = 0; i < 300; i++) total(count(3));
tell(() => total([1, 2] as any));
tell(() => total(null as any));
tell(() => total(count(0)));
log = "";
tell(() => restOf(4));
tell(() => restOf(1));
tell(() => restOf(0));
report(log);
log = "";
tell(() => twice(4));
tell(() => twice(1));
report(log);
tell(() => steppedInTurns(6));
tell(() => steppedInTurns(5));
report("end");
