// answers: without-library
// # What `super(..)` answers is what the constructor above returns, which need not be an instance.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
const other = { tag: "other", who() { return "the other object" } };
class Base { constructor(swap) { this.tag = "base"; if (swap) return other } who() { return "an instance" } }
class Derived extends Base { constructor(swap) { super(swap); this.more = 1 } }
function whoIs(object) { return object.who() }
report(whoIs(new Base(false)));
report(whoIs(new Base(true)));
report(whoIs(new Derived(false)));
report(whoIs(new Derived(true)));
report(new Derived(true) === other);
report(other.more);
report(new Derived(false) instanceof Derived);
report(new Derived(true) instanceof Derived);
report("end");
