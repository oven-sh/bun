function Base(k, a) { this.k = k; this.a = a; }
const bound = Base.bind(null, 7);
bound.prototype = Base.prototype;
class Below extends bound { constructor(a) { super(a); this.b = 2; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { const o = new Below(i); out.push(o.k + ":" + o.a + ":" + Object.keys(o).join("") + ":" + (o instanceof Below)); } return out.join(" "); }
console.log(run(3));
