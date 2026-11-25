var init = () => { const table = { step: 3 };
  class A { constructor(a) { this.a = a; } m() { return this.a + table.step; } get g() { return this.a * 2; } set g(v) { this.a = v; } static s() { return table.step; } static t() { return 4; } k() { return 1; } }
  return A; };
const A = init();
function measure(x) { x.g = x.g + 1; return x.m() + x.k() + x.g; }
console.log(measure(new A(1)), A.s(), A.t(), Object.getOwnPropertyNames(A.prototype).join(), Object.getOwnPropertyNames(A).join());
