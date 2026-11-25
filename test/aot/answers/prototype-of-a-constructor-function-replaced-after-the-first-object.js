// answers: without-library
// # If the prototype object that the function was made with stood above every object of the layout for good, the objects made behind `P.prototype = ..` would find the old methods, and instanceof and constructor would answer for the old object.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 16 of 16 of 16
// # CHECK-NEXT: exited with 0
function P(a) { this.x = a; }
P.prototype.name = function () { return "first" + this.x; };
function call(p) { return p.name(); }
const before = new P(1);
report(call(before));
const old = P.prototype;
P.prototype = { name: function () { return "second" + this.x; }, extra: 9 };
const after = new P(2);
report(call(before));
report(call(after));
report(before instanceof P);
report(after instanceof P);
report(old.isPrototypeOf(before));
report(before.extra);
report(after.extra);
report(after.constructor === P);
report(after.constructor === Object);
report(before.constructor === P);
P.prototype = 5;
const plain = new P(3);
report(Object.getPrototypeOf(plain) === Object.prototype);
report(plain.x);
report(typeof plain.name);
let failed = "no";
try { report(plain instanceof P); } catch (error) { failed = error instanceof TypeError; }
report(failed);
report("end");
