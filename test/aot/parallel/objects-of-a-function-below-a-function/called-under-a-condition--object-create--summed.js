function Base(a) { this.a = a; }
function peek(o) { return o.a; }
function sum(o, n) { let t = 0; for (let i = 0; i < n; i++) { const v = peek(o); t += v === undefined ? 1000 : v; } return t; }
function Below(a, b) { if (a & 1) Base.call(this, a); this.b = b; }
Below.prototype = Object.create(Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
console.log(sum(new Below(2, 2), 6)); console.log(sum(new Below(3, 2), 6));
