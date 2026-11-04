class Other { constructor() { this.kept = 0; } }
const shared = new Other();
class A { constructor() { return shared; } }
class B extends A { constructor(v) { super(v); this.x = v; } }
function look(a) { const before = a.x; new B(2); return before + " " + a.x; }
console.log(look(new B(1)));
