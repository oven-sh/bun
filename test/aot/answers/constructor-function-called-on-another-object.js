// answers: without-library
// # If only constructions counted as entering a constructor function, what call() and apply() bring as `this` (a literal, a finished object, a frozen one, undefined) would be stored into as a fresh object of the layout.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
function P(a) { this.x = a; this.y = a + 1; }
P.prototype.sum = function () { return this.x + this.y; };
const other = { y: "kept", z: 3 };
P.call(other, 5);
report(other.x);
report(other.y);
report(other.z);
report(typeof other.sum);
report(Object.keys(other).join());
const made = new P(1);
P.call(made, 10);
report(made.sum());
P.apply(made, [20]);
report(made.sum());
const frozen = Object.freeze({ x: 0 });
let refused = "stored";
try { P.call(frozen, 1); } catch (error) { refused = error instanceof TypeError; }
report(refused);
report(frozen.x);
let thrown = "none";
try { P.call(undefined, 1); } catch (error) { thrown = error instanceof TypeError; }
report(thrown);
report("end");
