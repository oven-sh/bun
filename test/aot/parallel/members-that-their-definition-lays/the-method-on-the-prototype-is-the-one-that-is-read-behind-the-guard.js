// What is read off an object behind the guard and what lies on the prototype object are one closure.
var init = () => { const table = { step: 3 };
  class A { constructor(a) { this.a = a; } m() { return this.a + table.step; } k() { return 1; } }
  return A; };
const A = init();
function read(x) { return x.m; }
function readSecond(x) { return x.k; }
const a = new A(1);
console.log(read(a) === A.prototype.m, readSecond(a) === A.prototype.k, read(a) === read(new A(2)), read(a).call({ a: 5 }), readSecond(a)());
