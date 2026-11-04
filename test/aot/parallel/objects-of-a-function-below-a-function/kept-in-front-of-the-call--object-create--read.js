function Base(a) { this.a = a; }
const kept = [];
function peek(o) { return o.a; }
function Below(a, b) { kept.push(this); if (kept.length === 3) throw new Error("stop"); Base.call(this, a); this.b = b; }
Below.prototype = Object.create(Base.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
try { make(5); } catch (e) { } console.log(String(peek(kept[2])));
