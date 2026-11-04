// An object goes into a container and comes out of it (list in a field). What comes out gets a field of another type, gains a property, loses one, gets an accessor, another prototype, or is frozen: whoever reads the object afterwards sees it.
class A { constructor() { this.x = "a"; this.y = 1; } get k() { return "A"; } }
class B { constructor() { this.x = "b"; this.y = 2; } get k() { return "B"; } }
class C { constructor() { this.x = "c"; this.y = 3; } get k() { return "C"; } }
class D { constructor() { this.x = "d"; this.y = 4; } get k() { return "D"; } }
class E { constructor() { this.x = "e"; this.y = 5; } get k() { return "E"; } }
class F { constructor() { this.x = "f"; this.y = 6; } get k() { return "F"; } }
function showA(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showB(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showC(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showD(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showE(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showF(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function changeA(o) { o.x = 7; }
function changeB(o) { o.z = true; }
function changeC(o) { delete o.y; }
function changeD(o) { Object.defineProperty(o, "x", { get() { return 42; }, configurable: true, enumerable: true }); }
function changeE(o) { Object.setPrototypeOf(o, { get k() { return "other"; } }); }
function changeF(o) { Object.freeze(o); try { o.x = 9; } catch {} }
class HA { constructor() { this.items = []; } add(v) { this.items.push(v); } first() { return this.items[0]; } }
function throughA(o) { const h = new HA(); h.add(o); return h.first(); }
class HB { constructor() { this.items = []; } add(v) { this.items.push(v); } first() { return this.items[0]; } }
function throughB(o) { const h = new HB(); h.add(o); return h.first(); }
class HC { constructor() { this.items = []; } add(v) { this.items.push(v); } first() { return this.items[0]; } }
function throughC(o) { const h = new HC(); h.add(o); return h.first(); }
class HD { constructor() { this.items = []; } add(v) { this.items.push(v); } first() { return this.items[0]; } }
function throughD(o) { const h = new HD(); h.add(o); return h.first(); }
class HE { constructor() { this.items = []; } add(v) { this.items.push(v); } first() { return this.items[0]; } }
function throughE(o) { const h = new HE(); h.add(o); return h.first(); }
class HF { constructor() { this.items = []; } add(v) { this.items.push(v); } first() { return this.items[0]; } }
function throughF(o) { const h = new HF(); h.add(o); return h.first(); }
const a = new A(), b = new B(), c = new C(), d = new D(), e = new E(), f = new F();
console.log(showA(a), showB(b), showC(c), showD(d), showE(e), showF(f));
changeA(throughA(a)); changeB(throughB(b)); changeC(throughC(c)); changeD(throughD(d)); changeE(throughE(e)); changeF(throughF(f));
console.log(showA(a));
console.log(showB(b));
console.log(showC(c));
console.log(showD(d));
console.log(showE(e));
console.log(showF(f));
