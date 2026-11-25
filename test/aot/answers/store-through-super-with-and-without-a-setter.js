// answers: without-library
// # A store through `super` runs the setter above the home object with the receiver as `this`. Where it comes to a method, a value or nothing it lays the property on the receiver, and where it comes to a getter alone it throws.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
class Base { constructor() { this.held = 1; this.log = "" } set value(next) { this.held = next } get value() { return this.held } get fixed() { return "fixed" } name() { return "base" } }
class Derived extends Base { constructor() { super(); this.own = 1 } store(next) { super.value = next } lay(next) { super.other = next } hide(next) { super.name = next } refuse(next) { super.fixed = next } }
const derived = new Derived();
derived.store(5);
report(derived.held);
report(Object.getOwnPropertyNames(derived).length);
derived.lay(6);
report(derived.other);
report(Base.prototype.other);
report(Object.getOwnPropertyNames(derived).length);
report(derived.name());
derived.hide(function () { return "hidden" });
report(derived.name());
report(new Derived().name());
let thrown = "nothing";
try { derived.refuse(7) } catch (error) { thrown = error instanceof TypeError }
report(thrown);
report(derived.fixed);
Object.defineProperty(Base.prototype, "value", { set(next) { this.held = next * 100 }, get() { return this.held }, configurable: true });
derived.store(5);
report(derived.held);
Object.defineProperty(Base.prototype, "value", { value: 1, writable: true, configurable: true });
derived.store(9);
report(derived.held);
report(derived.value);
report(Base.prototype.value);
report("end");
