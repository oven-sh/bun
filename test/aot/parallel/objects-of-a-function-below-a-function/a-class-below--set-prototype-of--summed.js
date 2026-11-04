function Base(a) { this.a = a; }
function peek(o) { return o.a; }
function sum(o, n) { let t = 0; for (let i = 0; i < n; i++) { const v = peek(o); t += v === undefined ? 1000 : v; } return t; }
function Below(a, b) { this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
class Lowest extends Below { constructor(a) { super(a, 3); this.c = 1; } } console.log(new Base(1).a); console.log(sum(new Lowest(1), 6));
