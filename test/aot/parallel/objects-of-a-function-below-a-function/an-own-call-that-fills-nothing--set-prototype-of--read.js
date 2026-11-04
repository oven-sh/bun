function Base(a) { this.a = a; }
function peek(o) { return o.a; }
function Below(a, b) { Base.call(this, a); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
console.log(String(peek(make(5)))); Base.call = function () { }; console.log(String(peek(make(5))));
