function Base(a) { this.a = a; }
class Below extends Base { constructor(a) { super(a); this.b = 2; } }
class Lowest extends Below { c = 3; constructor(a) { super(a); this.d = 4; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { const o = i & 1 ? new Lowest(i) : new Below(i); out.push(Object.keys(o).join("") + (Object.getPrototypeOf(o) === Lowest.prototype ? "L" : "B")); } return out.join(" "); }
console.log(run(4));
