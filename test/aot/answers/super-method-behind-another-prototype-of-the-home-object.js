// answers: without-library
// # `super.name()` looks above the home object as it stands when the call runs: the program lays another prototype object there.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
class Base { name() { return "base" } }
class Other { name() { return "other" } }
class Derived extends Base { name() { return "derived of " + super.name() } }
function nameOf(object) { return object.name() }
const derived = new Derived();
report(nameOf(derived));
Object.setPrototypeOf(Derived.prototype, Other.prototype);
report(nameOf(derived));
report(derived.name());
report(new Derived().name());
report("end");
