// answers: without-library
// # If `new P` always gave an object of P's layout, the object, the function or the list that the body returns in its place would be read by slots that it does not have.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
const spare = { x: "spare" };
function P(kind) { this.x = kind; if (kind === 1) return spare; if (kind === 2) return 7; if (kind === 3) return null; if (kind === 4) return function () { return "called"; }; if (kind === 5) return [1, 2]; }
function read(p) { return p.x; }
report(read(new P(0)));
report(read(new P(1)));
report(new P(1) === spare);
report(read(new P(2)));
report(read(new P(3)));
report(new P(4)());
report(read(new P(4)));
report(new P(5).length);
report(new P(1) instanceof P);
report(new P(2) instanceof P);
let seen = "";
for (let i = 0; i < 12; i++) seen += String(read(new P(i % 6)));
report(seen);
report("end");
