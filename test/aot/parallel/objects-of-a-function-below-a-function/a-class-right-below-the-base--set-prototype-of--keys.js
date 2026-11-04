function Base(a) { this.a = a; }
function Below(a, b) { Base.call(this, a); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
class Lowest extends Base { constructor(a) { super(a); this.c = 1; } } console.log(Object.keys(new Lowest(1)).join()); console.log(Object.keys(make(5)).join());
