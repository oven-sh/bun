// answers: without-library
// # A literal lists one field, and the others are stored behind it: on every way, on one way, behind a call that has seen the object.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
interface R { a: number; b?: number; c?: number; }
function make(v: boolean): R { const o: R = { a: 1 }; o.c = 3; if (v) o.b = 2; return o; }
function early(): R { const o: R = { a: 1 }; const seen = look(o); o.b = seen === undefined ? 20 : 21; o.c = 4; return o; }
function look(o: R): number | undefined { return o.b; }
function readA(o: R): number { return o.a; }
function readC(o: R): number | undefined { return o.c; }
report(readA(make(true)));
report(look(make(true)));
report(look(make(false)));
report(readC(make(false)));
report(look(early()));
report(readC(early()));
report("b" in make(false));
report("end");
