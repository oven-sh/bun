function Base(a) { this.a = a; }
Base.prototype.name = function () { return "old"; };
class Below extends Base { constructor(a) { super(a); } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) Base.prototype = { name() { return "new"; } }; out.push(new Below(i).name() + new Base(i).name() + (new Below(i) instanceof Base)); } return out.join(" "); }
console.log(run(4));
