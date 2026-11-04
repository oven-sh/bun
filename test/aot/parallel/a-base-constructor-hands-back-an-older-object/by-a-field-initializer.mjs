let first;
class A { constructor() { if (first) return first; first = this; } }
let next = 1;
class B extends A { x = next++; }
function look(a) { const before = a.x; new B(); return before + " " + a.x; }
console.log(look(new B()));
