// answers: without-library
// # If `constructor` always found the function of the layout, a store on the prototype object or on the object itself would be missed, and `new p.constructor` would make the wrong object.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
function P(a) { this.x = a; }
function Q(a) { this.x = a + 1; }
function again(p, a) { return new p.constructor(a); }
const p = new P(1);
report(p.constructor === P);
report(P.prototype.constructor === P);
report(p.hasOwnProperty("constructor"));
report(again(p, 5).x);
report(again(p, 5) instanceof P);
report(Object.keys(P.prototype).length);
P.prototype.constructor = Q;
report(p.constructor === Q);
report(again(p, 5).x);
report(again(p, 5) instanceof P);
report(again(p, 5) instanceof Q);
p.constructor = P;
report(again(p, 5).x);
report(new P(2).constructor === Q);
report(p.constructor.name);
report(P.name + P.length);
report("end");
