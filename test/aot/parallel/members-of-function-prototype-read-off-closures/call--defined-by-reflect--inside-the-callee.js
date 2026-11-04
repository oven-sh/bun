let turn = 0;
function Base(a) { this.a = a; if (++turn === 9) { Reflect.defineProperty(Base, "call", { value: g }); } }
function Other() { }
function g(self, a) { self.a = a + 100; }
function Below(a, b) { Base.call(this, a); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function deed() { }
function run(n, at) { let t = 0; for (let i = 0; i < n; i++) { if (i === at) deed(); const o = new Below(i & 7, 2); t += o.a + o.b; } return t; }
console.log(run(6, -1)); console.log(run(6, -1)); console.log(run(6, -1));
