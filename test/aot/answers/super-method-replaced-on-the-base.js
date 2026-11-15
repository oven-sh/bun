// answers: without-library
// # `super.name()` and a static `super.kind()` find what lies on the class above when the call runs.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
class Base { name() { return "base" } static kind() { return "static base" } }
class Derived extends Base { name() { return "derived of " + super.name() } static kind() { return "derived of " + super.kind() } }
const derived = new Derived();
report(derived.name());
report(Derived.kind());
Base.prototype.name = function () { return "replaced" };
Base.kind = function () { return "static replaced" };
report(derived.name());
report(Derived.kind());
report("end");
