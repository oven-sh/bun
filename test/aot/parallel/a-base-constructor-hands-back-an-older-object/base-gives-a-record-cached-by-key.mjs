const cache = new Map();
class A { constructor(v, key = "k") { if (!cache.has(key)) cache.set(key, { kept: 0 }); return cache.get(key); } }
class B extends A { constructor(v) { super(v); this.x = v; } }
function look(a) { const before = a.x; new B(2); return before + " " + a.x; }
console.log(look(new B(1)));
