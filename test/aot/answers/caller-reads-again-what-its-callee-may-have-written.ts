// answers: without-library
// # a caller reads a field, calls a function that stores by name and reads again: the same name, another name, two names for one object, a setter that writes another field, a loop
// # the form is that of bump(), whichever number it has: one name is written, in the objects of one class
// # RUN(FORM): link functions mechanisms=all
// # FORM: function {{*}}fields-written=1 layouts-written=1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Counter { n: number; m: number; constructor() { this.n = 0; this.m = 7; } }
class Gauge { w: number; constructor() { this.w = 0; } set v(x: number) { this.w = this.w + x; } }
function bump(c: Counter) { c.n = c.n + 1; }
function feed(g: Gauge, x: number) { g.v = x; }
function sameName(c: Counter) { const before = c.n; bump(c); return before * 10 + c.n; }
function otherName(c: Counter) { const before = c.m; bump(c); return before * 10 + c.m; }
function twoNames(a: Counter, b: Counter) { const before = a.n; bump(b); return before * 10 + a.n; }
function throughSetter(g: Gauge) { const before = g.w; feed(g, 5); return before * 10 + g.w; }
function inLoop(c: Counter) { let s = 0; for (let i = 0; i < 3; i++) { bump(c); s = s * 10 + c.n; } return s; }
const shared = new Counter();
report(sameName(new Counter()));
report(otherName(new Counter()));
report(twoNames(shared, shared));
report(twoNames(new Counter(), new Counter()));
report(throughSetter(new Gauge()));
report(inLoop(new Counter()));
report("end");
