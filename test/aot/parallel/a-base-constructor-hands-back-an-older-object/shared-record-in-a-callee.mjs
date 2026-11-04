const shared = { kept: 0 };
class A { constructor() { return shared; } }
class B extends A { constructor(v) { super(v); this.x = v; } }
function read(a) { return a.x; }
function look(a) { const before = read(a); new B(2); return before + " " + read(a); }
console.log(look(new B(1)));
