// Each evaluation lays closures of its own, over its own variables.
var init = (step) => { const table = { step };
  class A { constructor(a) { this.a = a; } m() { return this.a + table.step; } k() { return table.step; } }
  return A; };
function measure(x) { return x.m() + x.k(); }
const First = init(3);
console.log(measure(new First(1)));
const Second = init(100);
console.log(measure(new First(1)), measure(new Second(1)), First.prototype.m === Second.prototype.m, First.prototype.k === Second.prototype.k);
console.log(First.prototype.m.call({ a: 0 }), Second.prototype.m.call({ a: 0 }));
