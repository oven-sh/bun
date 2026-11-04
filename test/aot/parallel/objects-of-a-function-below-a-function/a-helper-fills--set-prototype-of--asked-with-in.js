function Base(a) { this.a = a; }
function fill(o, a) { o.a = a * 2; }
function Below(a, b) { fill(this, a); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
console.log(new Base(1).a); console.log("a" in make(5));
