let first;
class A { constructor() { if (first) return first; first = this; } }
class B extends A { constructor(v) { super(v); this.x = v; } }
const a = new B(1);
Object.freeze(a);
let second; try { new B(2); second = "made"; } catch (error) { second = error.name; }
console.log(a.x, second);
