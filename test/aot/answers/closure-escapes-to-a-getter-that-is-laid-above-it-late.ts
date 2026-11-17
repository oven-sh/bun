// answers: without-library
// # `victim.toString`, read off a plain closure: Function.prototype.toString is a constant unless the program writes it, so Link takes it for one: no code runs, the closure goes nowhere.
// # Then the flow comes to a function that lays a getter there. The member is let go again, and the getter gets the closure as `this`: whoever has read under the name has let the closure escape.
// # "no code runs above a closure under this name" was once remembered from the first asking: victim kept `callers-known` and `result=int`, and the call of what the getter had kept ended the executable (an illegal instruction).
// # The writer has to be reached LATER than the first read: it is called through a value that takes four calls to arrive.
// # f1 = victim
// # RUN(LINK): link functions mechanisms=all
// # LINK-NOT: function f1 callers-known
// # LINK: function f1 {{*}}result=number|string
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function victim(a: any) { return a + 1; }
let leaked: any;
function last() { Object.defineProperty(Function.prototype, "toString", { get() { leaked = this; return () => "text"; }, configurable: true }); }
function hop(g: any) { return g; }
const first = victim.toString;
const table = { go: hop(hop(hop(hop(last)))) };
table.go();
const second = victim.toString;
report(typeof first + " " + typeof second + " " + victim(1) + " " + victim(2));
report((leaked === victim) + " " + leaked("s") + " " + leaked({ valueOf() { return 5; } }));
report("end");
