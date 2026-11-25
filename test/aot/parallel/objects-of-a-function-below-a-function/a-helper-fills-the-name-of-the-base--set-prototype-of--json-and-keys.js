function Base(a) { this.a = a; }
function Below(a, b) { fill(this, a); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function fill(o, a) { o.a = a * 2; }
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
console.log(new Base(1).a);
const o = make(5);
console.log(JSON.stringify(o), Object.keys(o).join());
