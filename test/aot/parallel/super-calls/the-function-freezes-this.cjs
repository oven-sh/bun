function Base(a) { this.a = a; if (a & 1) Object.freeze(this); }
class Below extends Base { constructor(a) { super(a); this.b = 2; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { try { out.push(Object.keys(new Below(i)).join("")); } catch (e) { out.push(e.constructor.name); } } return out.join(" "); }
console.log(run(4));
