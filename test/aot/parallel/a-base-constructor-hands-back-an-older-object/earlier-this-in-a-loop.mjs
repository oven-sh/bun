let first;
class A { constructor() { if (first) return first; first = this; } }
class B extends A { constructor(v) { super(v); this.x = v; } }
function look(a) { let sum = 0; for (let i = 0; i < 4; i++) { sum += a.x; new B(a.x + 1); } return sum; }
console.log(look(new B(1)));
