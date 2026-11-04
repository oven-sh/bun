function Base(a) { this.a = a; }
function Other() { }
function g(self, list) { self.a = list[0] + 100; }
function Below(a, b) { Base.apply(this, [a]); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function deed() { }
function run(n, at) { let t = 0; for (let i = 0; i < n; i++) { if (i === at) deed(); const o = new Below(i & 7, 2); t += o.a + o.b; } return t; }
console.log(run(6, -1)); Object.defineProperty(Base, "apply", { value: g }); console.log(run(6, -1));
