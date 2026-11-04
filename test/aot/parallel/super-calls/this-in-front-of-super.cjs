function Base(a) { this.a = a; }
class Below extends Base { constructor(a) { if (a === 1) this.early = 1; super(a); } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { try { out.push(new Below(i).a); } catch (e) { out.push(e.constructor.name); } } return out.join(" "); }
console.log(run(3));
