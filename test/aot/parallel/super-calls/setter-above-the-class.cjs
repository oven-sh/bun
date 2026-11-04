const log = [];
function Base(a) { this.a = a; }
Object.defineProperty(Base.prototype, "b", { set(v) { log.push("set " + v); }, get() { return "got"; }, configurable: true });
class Below extends Base { constructor(a) { super(a); this.b = a; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { const o = new Below(i); out.push(Object.keys(o).join("") + o.b); } return out.join(" "); }
console.log(run(3), log.join(","));
