// answers: without-library
// # `new` of each class of a row, and Reflect.construct() of the lowest with the highest as new.target: the object has the layout that new.target selects.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
class Low { constructor(a) { this.a = a } who() { return "low" } sum() { return this.a } }
class Middle extends Low { constructor(a, b) { super(a); this.b = b } who() { return "middle over " + super.who() } sum() { return super.sum() + this.b } }
class High extends Middle { constructor(a, b, c) { super(a, b); this.c = c } sum() { return super.sum() + this.c } }
function describe(object) { return object.who() + " " + object.sum() }
report(describe(new Low(1)));
report(describe(new Middle(1, 2)));
report(describe(new High(1, 2, 3)));
report(Object.getPrototypeOf(new High(1, 2, 3)) === High.prototype);
report(Object.getPrototypeOf(new Middle(1, 2)) === Middle.prototype);
report(new High(1, 2, 3) instanceof Low);
report(new Low(1) instanceof Middle);
const reflected = Reflect.construct(Low, [7], High);
report(reflected instanceof High);
report(reflected.a);
report(reflected.c);
report(reflected.who());
report(Object.keys(new High(1, 2, 3)).join());
report("end");
