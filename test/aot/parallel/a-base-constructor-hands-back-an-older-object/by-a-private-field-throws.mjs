let first;
class A { constructor() { if (first) return first; first = this; } }
class B extends A { #x = 1; static read(o) { return o.#x; } }
const a = new B();
let second; try { new B(); second = "made"; } catch (error) { second = error.name; }
console.log(B.read(a), second);
