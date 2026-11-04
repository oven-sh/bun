// The guard that no longer ends at the definition still ends at a store.
var init = () => { const table = { step: 3 };
  class A { constructor(a) { this.a = a; } m() { return this.a + table.step; } k() { return 1; } }
  class B extends A { m() { return this.a * table.step; } }
  return { A, B }; };
const { A, B } = init();
function measure(x) { return x.m() + x.k(); }
console.log(measure(new A(1)), measure(new B(1)));
A.prototype.k = function () { return 50; };
console.log(measure(new A(1)), measure(new B(1)));
(0, eval)("(C) => { C.prototype.m = function () { return 7; }; }")(B);
console.log(measure(new A(1)), measure(new B(1)));
