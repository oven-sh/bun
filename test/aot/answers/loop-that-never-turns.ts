// answers: without-library
// # what is written as a loop and never comes round has no poll. Its body runs once, by every way out
// # (What is written `while (false)` is no loop for the front end already.)
// # f3 = once, f4 = left, f5 = labeled, f6 = under, f1 = around, f7 = turns, f2 = tell, f8 = each
// # RUN(FORM): walk f3 f5 mechanisms=none+Folding
// # FORM-NOT: LoopHint
// # RUN(WRITTEN): walk f3 mechanisms=none
// # WRITTEN-LABEL: code f3:Body
// # WRITTEN: = LoopHint
// # RUN(KEPT): walk f7 mechanisms=none+Folding
// # KEPT-LABEL: code f7:Body
// # KEPT: = LoopHint
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 51 of 51 of 51
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function once(o: any) { let x; do { x = o.x; } while (1 > 2); return x; }
function left(o: any) { for (;;) { log += "turn;"; if (o.x) return "x"; break; } return "none"; }
function labeled(o: any) { let text = ""; block: do { text += "a"; if (o.x) break block; text += "b"; } while (1 > 2); return text; }
function under(o: any) { try { do { log += "turn;"; if (o.x) throw new RangeError("x"); } while (1 > 2); } catch (e) { return e instanceof RangeError ? e.message : (e as Error).name; } return "none"; }
function around(n: number, o: any) { let s = 0; for (let i = 0; i < n; i++) { do { s += o.x; } while (1 > 2); } return s; }
function turns(n: number) { let i = 0; do { i++; } while (i < n); return i; }
function tell(f: () => unknown) { log = ""; try { report(f()); } catch (e) { report((e as Error).name); } report(log); }
function each(f: (o: any) => unknown) { tell(() => f({ x: 1 })); tell(() => f({ x: 0 })); tell(() => f({ get x() { log += "read;"; return 2; } })); tell(() => f(null)); }
each(once);
each(left);
each(labeled);
each(under);
each(o => around(3, o));
each(o => around(0, o));
report(turns(0));
report(turns(5));
report("end");
