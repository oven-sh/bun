// answers: without-library
// # If a field that some path of the constructor stores counted as filled, the object of the other path (a branch, an early return, a throw) would read an empty slot, where the lookup goes on to the prototype object.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
function P(a) { this.x = a; if (a > 2) this.big = true; else this.small = a; this.last = "z"; }
P.prototype.big = "from above";
function show(p) { return String(p.big) + "|" + String(p.small) + "|" + p.last + "|" + Object.keys(p).join(); }
report(show(new P(1)));
report(show(new P(3)));
report(new P(1).hasOwnProperty("big"));
report(new P(3).hasOwnProperty("big"));
let text = "";
for (let i = 0; i < 6; i++) text += show(new P(i)) + ";";
report(text);
function Q(stop) { this.a = 1; if (stop) return; this.b = 2; }
report(String(new Q(true).b) + String(new Q(false).b));
function R(fail) { this.a = 1; if (fail) throw this; this.b = 2; }
let half;
try { new R(true); } catch (thrown) { half = thrown; }
report(String(half.a) + String(half.b) + (half instanceof R));
report("end");
