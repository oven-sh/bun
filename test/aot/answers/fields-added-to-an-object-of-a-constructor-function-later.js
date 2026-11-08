// answers: without-library
// # If the layout held all that an object of a constructor function ever has, a name that is stored later, deleted, stored again or laid on the prototype object afterwards would be missed, or come in the wrong order of keys.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
function P(a) { this.x = a; }
function late(p) { return p.late; }
function grow(p, value) { p.late = value; p.later = value + 1; return p; }
const bare = new P(1);
const grown = grow(new P(2), 10);
report(late(bare));
report(late(grown));
report(grown.later);
report(Object.keys(bare).join());
report(Object.keys(grown).join());
report("late" in bare);
report("late" in grown);
delete grown.x;
report(grown.x);
report(Object.keys(grown).join());
grown.x = 5;
report(Object.keys(grown).join());
P.prototype.late = "above";
report(late(bare));
report(late(grown));
let total = 0;
for (let i = 0; i < 200; i++) { const p = new P(i); if (i & 1) grow(p, i); total += typeof late(p) === "number" ? late(p) : 1000; }
report(total);
report("end");
