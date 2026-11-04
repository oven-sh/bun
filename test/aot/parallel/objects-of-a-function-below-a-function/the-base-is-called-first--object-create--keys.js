function Base(a) { this.a = a; }
function Below(a, b) { Base.call(this, a); this.b = b; }
Below.prototype = Object.create(Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
console.log(Object.keys(make(5)).join());
