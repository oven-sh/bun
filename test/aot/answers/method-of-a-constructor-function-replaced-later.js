// answers: without-library
// # If a method that a statement lays on the prototype object counted as found, the call in front of the statement would not throw, and the calls behind a second store, an own property, a deletion, a number or a getter would enter the first function.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
function P(a) { this.x = a; }
function call(p) { return p.get(); }
const early = new P(1);
let missing = "found";
try { call(early); } catch (error) { missing = error instanceof TypeError; }
report(missing);
P.prototype.get = function () { return this.x; };
report(call(early));
let total = 0;
for (let i = 0; i < 100; i++) total += call(new P(i));
report(total);
P.prototype.get = function () { return this.x * 2; };
report(call(early));
early.get = function () { return "own"; };
report(call(early));
report(call(new P(4)));
delete early.get;
report(call(early));
delete P.prototype.get;
missing = "found";
try { call(early); } catch (error) { missing = error instanceof TypeError; }
report(missing);
P.prototype.get = 5;
missing = "found";
try { call(early); } catch (error) { missing = error instanceof TypeError; }
report(missing);
Object.defineProperty(P.prototype, "get", { get() { const self = this; return function () { return "by getter " + self.x; }; }, configurable: true });
report(call(early));
report("end");
