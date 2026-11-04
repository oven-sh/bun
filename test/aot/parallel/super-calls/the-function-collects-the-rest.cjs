function Base(a, ...rest) { this.a = a; this.rest = rest.join("|"); }
class Below extends Base { constructor(...all) { super(...all); } }
class Written extends Base { constructor(a) { super(a, 2, 3); } }
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new Below(i, 5, 6).rest + ":" + new Written(i).rest); return out.join(" "); }
console.log(run(3));
