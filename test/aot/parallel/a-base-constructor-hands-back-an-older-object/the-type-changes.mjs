let first;
class A { constructor() { if (first) return first; first = this; } }
class B extends A { constructor(v) { super(v); this.x = v; } }
function look(a) { const before = a.x + 1; new B("text"); return before + " " + (a.x + 1); }
console.log(look(new B(1)));
