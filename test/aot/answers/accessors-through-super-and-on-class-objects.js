// answers: without-library
// # `super.value` runs the getter of the class above with the receiver as `this`, a store through `super` its setter, and a static getter runs with the class object that was asked.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
class Base { constructor() { this.held = 1 } get value() { return this.held } set value(next) { this.held = next } static get label() { return "label of " + this.tag } static set label(next) { this.tag = next } }
Base.tag = "base";
class Derived extends Base { constructor() { super(); this.own = 1 } get value() { return super.value * 10 } set value(next) { super.value = next + 1 } static get label() { return "derived " + super.label } }
Derived.tag = "derived";
const derived = new Derived();
report(derived.value);
derived.value = 4;
report(derived.held);
report(derived.value);
report(Base.label);
report(Derived.label);
Base.label = "changed";
report(Base.label);
report(Derived.label);
report("end");
