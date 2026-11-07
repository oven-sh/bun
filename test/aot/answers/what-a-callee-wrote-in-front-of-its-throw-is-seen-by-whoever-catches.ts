// answers: without-library
// # a callee writes a field and throws: the caller that catches sees the field in its handler and behind it, and so does the caller of a function that swallows the throw
// # the form is that of set(), whichever number it has
// # RUN(FORM): summary
// # FORM: access {{*}}"bad" {{*}}on-no-way-to-return
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Cell { v: number; bad: number; constructor() { this.v = 0; this.bad = 0; } }
function set(o: Cell, v: number) { if (v < 0) { o.bad = v; throw v; } o.v = v; }
function swallow(o: Cell, v: number) { try { set(o, v); } catch (e) { return false; } return true; }
function guarded(o: Cell, v: number) { const before = o.bad; try { set(o, v); } catch (e) { return before * 100 + o.bad; } return before * 100 + o.bad + o.v; }
function outer(o: Cell, v: number) { const before = o.bad; swallow(o, v); return before * 100 + o.bad + o.v; }
function inLoop(o: Cell) { let s = 0; for (let i = 0; i < 3; i++) { swallow(o, i - 2); s = s * 10 + o.bad + o.v; } return s; }
report(guarded(new Cell(), -1));
report(guarded(new Cell(), 4));
report(outer(new Cell(), -3));
report(outer(new Cell(), 3));
report(inLoop(new Cell()));
report("end");
