function Base(a) { this.a = a; }
function Below(a, b) { this.b = b; }
Below.prototype = Object.create(Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
class Lowest extends Below { constructor(a) { super(a, 3); this.c = 1; } } console.log(new Base(1).a); console.log("a" in new Lowest(1));
