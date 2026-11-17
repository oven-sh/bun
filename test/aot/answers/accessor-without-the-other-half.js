// answers: without-library
// # A class below defines one half of an accessor: the pair of the class above is hidden, so a store without a setter throws in strict code and a read without a getter gives undefined.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
class Base { constructor() { this.held = 1 } get value() { return this.held } set value(next) { this.held = next } }
class OnlyGetter extends Base { constructor() { super(); this.own = 1 } get value() { return "getter alone" } }
class OnlySetter extends Base { constructor() { super(); this.own = 2 } set value(next) { this.held = next * 2 } }
const getter = new OnlyGetter();
const setter = new OnlySetter();
report(getter.value);
let thrown = "nothing";
try { getter.value = 5 } catch (error) { thrown = error instanceof TypeError }
report(thrown);
report(getter.held);
report(setter.value);
setter.value = 5;
report(setter.held);
report(setter.value);
report("end");
