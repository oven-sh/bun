// answers: without-library
// # Static methods and accessors on a class object: a store, another class object laid above, a definition by a descriptor.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
class Base { static make() { return "base" } static get label() { return "label of base" } }
class Derived extends Base { static own() { return "own" } }
class Other { static make() { return "other" } static get label() { return "label of other" } }
function make(from) { return from.make() }
report(Base.make());
report(Derived.make());
report(Derived.own());
report(Derived.label);
report(make(Derived));
Derived.own = function () { return "own replaced" };
report(Derived.own());
Object.setPrototypeOf(Derived, Other);
report(Derived.make());
report(Derived.label);
report(make(Derived));
report(Base.make());
Object.defineProperty(Base, "label", { get() { return "label defined anew" }, configurable: true });
report(Base.label);
report("end");
