function Base(a, b) { this.a = a; this.b = b; this.n = arguments.length; }
class Below extends Base { constructor(k) { if (k === 0) super(); else if (k === 1) super(1); else super(1, 2, 3); } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { const o = new Below(i % 3); out.push(String(o.a) + String(o.b) + o.n); } return out.join(" "); }
console.log(run(6));
