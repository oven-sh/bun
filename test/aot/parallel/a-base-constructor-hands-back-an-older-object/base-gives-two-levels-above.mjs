const shared = { kept: 0 };
class Top { constructor() { return shared; } }
class A extends Top { constructor(v) { super(v); } }
class B extends A { constructor(v) { super(v); this.x = v; } }
function look(a) { const before = a.x; new B(2); return before + " " + a.x; }
console.log(look(new B(1)));
