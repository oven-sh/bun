const shared = { kept: 0 };
class A { constructor() { return shared; } }
class B extends A { constructor(v) { super(v); this.x = v; } }
const a = new B(1);
const before = a.x;
new B(2);
console.log(before, a.x);
