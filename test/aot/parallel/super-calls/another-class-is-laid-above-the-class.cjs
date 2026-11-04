class Base { constructor(a) { this.a = a; } }
class Other { constructor(a) { this.o = a * 10; } }
class Below extends Base { constructor(a) { super(a); this.b = 2; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) Object.setPrototypeOf(Below, Other); const o = new Below(i); out.push(Object.keys(o).join("+") + ":" + (o instanceof Base) + ":" + (o instanceof Below)); } return out.join(" "); }
console.log(run(5));
