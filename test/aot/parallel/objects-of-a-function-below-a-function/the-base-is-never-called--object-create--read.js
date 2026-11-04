function Base(a) { this.a = a; }
function peek(o) { return o.a; }
function Below(a, b) { this.b = b; }
Below.prototype = Object.create(Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
console.log(new Base(1).a); console.log(String(peek(make(5))));
