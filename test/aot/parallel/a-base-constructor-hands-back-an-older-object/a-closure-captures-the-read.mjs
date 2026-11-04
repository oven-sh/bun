let first;
class A { constructor() { if (first) return first; first = this; } }
class B extends A { constructor(v) { super(v); this.x = v; } }
const a = new B(1);
const read = () => a.x;
const before = read();
new B(2);
console.log(before, read());
