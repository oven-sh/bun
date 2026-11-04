function Base(a) { this.a = a; if (a & 1) return { other: a }; }
class Below extends Base { constructor(a) { super(a); this.b = 2; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { const o = new Below(i); out.push(Object.keys(o).join("+") + ":" + (o instanceof Below)); } return out.join(" "); }
console.log(run(4));
