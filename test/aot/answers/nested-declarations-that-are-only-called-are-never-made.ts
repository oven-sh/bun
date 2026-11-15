// answers: without-library
// # a function that a function declares and that is only called by its name is entered itself, with what it captures at hand: no closure is made, and its name has no place in the scope
// # function outer(a, b) { let n = 0; return first(a) + second(b) + n; function first(x) { n++; return x > 0 ? second(x - 1) : a; } function second(y) { .. first(y - 1) .. } }
// # f1 = outer, f3 = first, f4 = second, f2 = keeps, f5 = bump
// # RUN(FORM): walk f1 mechanisms=none
// # FORM-LABEL: code f1:Body
// # FORM: = CallDirect {{*}}function=f3
// # RUN(NEVER): walk f1 mechanisms=none
// # NEVER-NOT: = NewClosure
// # RUN(SIBLING): walk f3 mechanisms=none
// # SIBLING: = CallDirect {{*}}function=f4
// # RUN(VALUE): walk f2 mechanisms=none
// # VALUE: = NewClosure {{*}}function=f5
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
// # RUN(ALSO3): run-in-shell mechanisms=-UnboxedNumbers $SHELL
// # ALSO3: 7 of 7 of 7
// # ALSO3-NEXT: exited with 0
declare function report(value: unknown): void;
function outer(a: number, b: number) { let n = 0; const r = first(a) + second(b); return r + n; function first(x: number): number { n++; return x > 0 ? second(x - 1) : a; } function second(y: number): number { n += 2; return y > 0 ? first(y - 1) : b; } }
function keeps(start: number) { let n = start; bump(1); return bump; function bump(x: number): number { n += x; return n; } }
report(outer(3, 4));
report(outer(0, 0));
report(outer(7, 1));
const kept = keeps(10);
report(kept(5));
report(kept(5));
report(keeps(0) === keeps(0));
report("end");
