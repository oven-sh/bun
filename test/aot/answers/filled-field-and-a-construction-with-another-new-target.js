// answers: without-library
// # Reflect.construct(A, [], B) makes an object under the prototype of B that the constructor and the initializer of B have never seen.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
class A { constructor() { this.a = 1; } readA() { return this.a; } }
class B extends A { w = 4; constructor() { super(); this.b = 2; } readB() { return this.b; } readW() { return this.w; } }
const odd = Reflect.construct(A, [], B);
report(odd.readA());
report(odd.readB());
report(odd.readW());
report(odd instanceof B);
const made = new B();
report(made.readA());
report(made.readB());
report(made.readW());
report("end");
