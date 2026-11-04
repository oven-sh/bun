function Base(a) { this.a = a; }
function early(o) { return o.a; }
function peek(o) { return o.a; }
function Below(a, b) { this.seen = String(early(this)); Base.call(this, a); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
const o = make(5); console.log(o.seen); console.log(String(peek(o)));
