function Base(a) { this.a = a; }
class Parent { constructor(a) { this.p = a; } }
class Below extends Base { constructor(a) { super(a); this.b = 2; } }
class Under extends Parent { constructor(a) { super(a); this.u = 3; } }
function one(a) { return new Below(a); }
function two(a) { return new Under(a); }
console.log(Object.keys(one(1)).join(), Object.keys(two(1)).join());
Object.setPrototypeOf(Below, Parent); Object.setPrototypeOf(Under, Base);
console.log(Object.keys(one(1)).join(), Object.keys(two(1)).join());
