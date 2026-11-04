function Base(a) { this.a = a; }
class Below extends Base { constructor(a) { const go = () => super(a); go(); this.b = this.a + 1; } }
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Below(i).b; return t; }
console.log(run(4), Object.keys(new Below(1)).join());
