let first;
class A { constructor() { if (first) return first; first = this; } }
class B extends A { constructor(f) { super(); this.run = f; } }
function look(a) { const before = a.run(); new B(() => 2); return before + " " + a.run(); }
console.log(look(new B(() => 1)));
