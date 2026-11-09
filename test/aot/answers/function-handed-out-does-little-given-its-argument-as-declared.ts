// answers: without-library
// # two functions are handed to code that nobody has seen, so anything arrives at their parameters. Given a Shape as declared the store of move() finds a field, and the call in each() is left to whoever knows what he hands over
// # f1 = move, f2 = each
// # RUN(FORM): link functions mechanisms=all
// # FORM: function f1 {{*}}mayCallUnknownCode
// # FORM: given-arguments as-expected=[0] layouts-written=1 returns=[
// # FORM: function f2 {{*}}mayCallUnknownCode
// # FORM: given-arguments called=[0] layouts-written=none returns=[
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Shape { w: number; constructor() { this.w = 0; } }
function move(s: Shape, w: number) { s.w = w; }
function each(visit: () => void) { visit(); }
function widen(s: Shape) { const before = s.w; move(s, 5); return before * 10 + s.w; }
function count(box: { n: number }) { const before = box.n; each(() => { box.n = box.n + 1; }); return before * 10 + box.n; }
(report as any)("handed out", move, each);
report(widen(new Shape()));
report(count({ n: 1 }));
report("end");
