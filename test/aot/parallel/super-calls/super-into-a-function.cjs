function Base(a) { this.a = a; }
Base.prototype.first = function () { return this.a; };
class Below extends Base { constructor(a, b) { super(a); this.b = b; } second() { return this.b + this.first(); } }
function run(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new Below(i, 2); t += o.second() + o.a; } return t; }
const one = new Below(1, 2);
console.log(run(5), one instanceof Base, one instanceof Below, Object.getPrototypeOf(one) === Below.prototype, Object.keys(one).join(), JSON.stringify(one));
