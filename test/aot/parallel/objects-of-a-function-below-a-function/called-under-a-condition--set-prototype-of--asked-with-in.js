function Base(a) { this.a = a; }
function Below(a, b) { if (a & 1) Base.call(this, a); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
console.log("a" in new Below(2, 2)); console.log("a" in new Below(3, 2));
