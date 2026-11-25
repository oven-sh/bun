// answers: without-library
// # `const f = (..) => ..` in a function, called by its name behind the initialization, is entered itself, and a name that nobody reads has no closure
// # a closure that is made in front of the initialization reads the name as ever, and throws where it is called early; a name that is also read as a value has its one closure
// # f1 = outer, f4 = add, f5 = twice, f2 = early, f6 = run, f7 = filled, f3 = keeps, f8 = kept
// # RUN(FORM): walk f1 mechanisms=none
// # FORM-LABEL: code f1:Body
// # FORM: = CallDirect {{*}}function=f5
// # RUN(NEVER): walk f1 mechanisms=none
// # NEVER-NOT: = NewClosure
// # RUN(EARLY): walk f6 mechanisms=none
// # EARLY: = CheckInitialized
// # RUN(READS): walk f6 mechanisms=none
// # READS-NOT: = CallDirect
// # RUN(VALUE): walk f3 mechanisms=none
// # VALUE: = NewClosure {{*}}function=f8
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 7 of 7 of 7
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-DirectCalls $SHELL
// # ALSO2: 7 of 7 of 7
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
function outer(a: number, b: number) { let n = 0; const add = (x: number): number => { n++; return x + a; }; const twice = (x: number): number => add(add(x)) + b; return twice(1) + add(2) + n; }
function early(first: boolean) { let said = ""; const run = () => filled(); if (first) { try { said += run(); } catch (e) { said += "threw"; } } const filled = () => "filled"; return said + run() + filled(); }
function keeps() { const kept = (x: number) => x + 1; return kept(1) === 2 ? kept : kept; }
report(outer(10, 100));
report(outer(1, 2));
report(early(true));
report(early(false));
report(keeps()(4));
report(keeps() === keeps());
report("end");
