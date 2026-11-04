function Base(a) { this.a = a; }
function peek(o) { return o.a; }
function sum(o, n) { let t = 0; for (let i = 0; i < n; i++) { const v = peek(o); t += v === undefined ? 1000 : v; } return t; }
function Below(a, b) { Base.call(this, a); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
console.log(sum(make(5), 6)); Base.call = function (self, a) { self.a = a * 2; }; console.log(sum(make(5), 6));
