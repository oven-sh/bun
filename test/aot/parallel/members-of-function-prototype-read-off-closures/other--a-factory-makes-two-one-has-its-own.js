function g(self, a) { self.a = a + 100; }
function make() { return function Base(a) { this.a = a; }; }
const A = make(), B = make();
B.call = g;
function run(n) { let t = 0; for (let i = 0; i < n; i++) { const o = { }; (i & 1 ? A : B).call(o, i); t += o.a; } return t; }
console.log(run(6));
