let first;
class A { constructor() { if (first) return first; first = this; } }
class B extends A { constructor(v) { super(v); this.x = v; } }
function read(a) { return a.x; }
function look(a) { const before = read(a); new B(2); return before + " " + read(a); }
console.log(look(new B(1)));
