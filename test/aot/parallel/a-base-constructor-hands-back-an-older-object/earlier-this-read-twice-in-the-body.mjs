let first;
class A { constructor() { if (first) return first; first = this; } }
class B extends A { constructor(v) { super(v); this.x = v; } }
const a = new B(1);
const before = a.x;
new B(2);
console.log(before, a.x);
