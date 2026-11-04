function Base(a) { this.a = a; }
function Below(a, b) { Base.call(this, a); this.b = b; }
require("node:util").inherits(Below, Base);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Below(i & 7, 2); return last; }
console.log(JSON.stringify(make(5)));
