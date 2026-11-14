function Base(a) { this.a = a; }
function Below(a, b) { this.seen = peek(this); Base.call(this, a); this.b = b; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
function peek(o) { return o.a; }
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
const o = make(5);
console.log(JSON.stringify(o), Object.keys(o).join(), String(o.seen), typeof o.seen);
