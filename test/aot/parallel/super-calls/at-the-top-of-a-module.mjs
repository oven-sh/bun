function Base(a) { this.a = a; }
Base.prototype.first = function () { return this.a; };
class Below extends Base { constructor(a, b) { super(a); this.b = b; } second() { return this.b + this.first(); } }
let total = 0;
for (let i = 0; i < 5; i++) { const item = new Below(i, 2); total += item.second() + item.a; }
console.log(total);
