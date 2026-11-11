// answers: without-library
// # `super(..)` constructs with what stands above the class object when it runs.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
class Base { constructor(held) { this.held = held; this.madeBy = "base" } }
class Other { constructor(held) { this.held = held * 10; this.madeBy = "other" } }
class Derived extends Base { constructor(held) { super(held); this.more = 1 } }
function make(held) { return new Derived(held) }
const first = make(1);
report(first.held);
report(first.madeBy);
Object.setPrototypeOf(Derived, Other);
const second = make(2);
report(second.held);
report(second.madeBy);
report(second.more);
report(second instanceof Derived);
report(second instanceof Base);
report("end");
