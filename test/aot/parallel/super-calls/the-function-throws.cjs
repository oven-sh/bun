function Base(a) { if (a === 2) throw new RangeError("two"); this.a = a; }
class Below extends Base { constructor(a) { super(a); this.b = 2; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { try { out.push(new Below(i).a); } catch (e) { out.push(e.constructor.name + ":" + e.message); } } return out.join(" "); }
console.log(run(4));
