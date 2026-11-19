function Base(a) { this.a = a; }
class Below extends Base { constructor(a) { super(a); this.b = 2; } }
function Stranger() {}
Stranger.prototype.mark = "stranger";
class Apart {}
function run(n) { const out = []; for (let i = 0; i < n; i++) { const o = Reflect.construct(Below, [i], i & 1 ? Stranger : Apart); out.push(Object.keys(o).join("") + ":" + o.mark + ":" + (o instanceof Below) + ":" + (o instanceof Apart)); } return out.join(" "); }
console.log(run(4));
