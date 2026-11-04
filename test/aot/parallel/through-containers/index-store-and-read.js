// An object goes into a container and comes out of it (index store and read). What comes out gets a field of another type, gains a property, loses one, gets an accessor, another prototype, or is frozen: whoever reads the object afterwards sees it.
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
function putA(list, i, v) { list[i] = v; }
function takeA(list, i) { return list[i]; }
function throughA(o) { const list = []; putA(list, 0, o); return takeA(list, 0); }
function putB(list, i, v) { list[i] = v; }
function takeB(list, i) { return list[i]; }
function throughB(o) { const list = []; putB(list, 0, o); return takeB(list, 0); }
function putC(list, i, v) { list[i] = v; }
function takeC(list, i) { return list[i]; }
function throughC(o) { const list = []; putC(list, 0, o); return takeC(list, 0); }
function putD(list, i, v) { list[i] = v; }
function takeD(list, i) { return list[i]; }
function throughD(o) { const list = []; putD(list, 0, o); return takeD(list, 0); }
function putE(list, i, v) { list[i] = v; }
function takeE(list, i) { return list[i]; }
function throughE(o) { const list = []; putE(list, 0, o); return takeE(list, 0); }
function putF(list, i, v) { list[i] = v; }
function takeF(list, i) { return list[i]; }
function throughF(o) { const list = []; putF(list, 0, o); return takeF(list, 0); }
const a = new A(), b = new B(), c = new C(), d = new D(), e = new E(), f = new F();
console.log(showA(a), showB(b), showC(c), showD(d), showE(e), showF(f));
changeA(throughA(a)); changeB(throughB(b)); changeC(throughC(c)); changeD(throughD(d)); changeE(throughE(e)); changeF(throughF(f));
console.log(showA(a));
console.log(showB(b));
console.log(showC(c));
console.log(showD(d));
console.log(showE(e));
console.log(showF(f));
