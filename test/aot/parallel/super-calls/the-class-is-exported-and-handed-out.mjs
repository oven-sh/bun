export class A { constructor(a) { this.a = a; } first() { return this.a; } }
export class B extends A { constructor(a, b) { super(a); this.b = b; } second() { return this.b + this.first(); } }
const registry = (0, eval)("({})");
registry.A = A; registry.B = B;
function run(count) { let total = 0; for (let i = 0; i < count; i++) { const item = new B(i, 2); total += item.second() + item.a; } return total; }
console.log(run(5), Object.keys(new B(1, 2)).join(), new B(1, 2) instanceof A);
