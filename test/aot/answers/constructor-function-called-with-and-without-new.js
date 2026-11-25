// answers: without-library
// # If `this` of a function that is constructed counted as an object of its layout whoever enters, the plain call, which brings undefined, would store into nothing.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
function P(a) { if (this === undefined) return a + 100; this.x = a; this.y = a * 2; }
function sum(p) { return p.x + p.y; }
const made = new P(1);
report(sum(made));
report(P(2));
report(made.x);
let total = 0;
for (let i = 0; i < 300; i++) { const p = new P(i); total += sum(p) + P(i); }
report(total);
report(made instanceof P);
report(Object.keys(made).join());
report("end");
