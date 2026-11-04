// An object goes into a container and comes out of it (json stringify with to json). What comes out gets a field of another type, gains a property, loses one, gets an accessor, another prototype, or is frozen: whoever reads the object afterwards sees it.
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
let keepA;
class WA { constructor(v) { this.v = v; } toJSON() { keepA = this.v; return 0; } }
function throughA(o) { JSON.stringify([{ inner: new WA(o) }]); return keepA; }
let keepB;
class WB { constructor(v) { this.v = v; } toJSON() { keepB = this.v; return 0; } }
function throughB(o) { JSON.stringify([{ inner: new WB(o) }]); return keepB; }
let keepC;
class WC { constructor(v) { this.v = v; } toJSON() { keepC = this.v; return 0; } }
function throughC(o) { JSON.stringify([{ inner: new WC(o) }]); return keepC; }
let keepD;
class WD { constructor(v) { this.v = v; } toJSON() { keepD = this.v; return 0; } }
function throughD(o) { JSON.stringify([{ inner: new WD(o) }]); return keepD; }
let keepE;
class WE { constructor(v) { this.v = v; } toJSON() { keepE = this.v; return 0; } }
function throughE(o) { JSON.stringify([{ inner: new WE(o) }]); return keepE; }
let keepF;
class WF { constructor(v) { this.v = v; } toJSON() { keepF = this.v; return 0; } }
function throughF(o) { JSON.stringify([{ inner: new WF(o) }]); return keepF; }
const a = new A(), b = new B(), c = new C(), d = new D(), e = new E(), f = new F();
console.log(showA(a), showB(b), showC(c), showD(d), showE(e), showF(f));
changeA(throughA(a)); changeB(throughB(b)); changeC(throughC(c)); changeD(throughD(d)); changeE(throughE(e)); changeF(throughF(f));
console.log(showA(a));
console.log(showB(b));
console.log(showC(c));
console.log(showD(d));
console.log(showE(e));
console.log(showF(f));
