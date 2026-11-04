// An object goes into a container and comes out of it (event target). What comes out gets a field of another type, gains a property, loses one, gets an accessor, another prototype, or is frozen: whoever reads the object afterwards sees it.
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
let keptA;
function sendA(v) { const t = new EventTarget(); t.addEventListener("e", e => { keptA = e.detail; }); t.dispatchEvent(new CustomEvent("e", { detail: v })); }
function throughA(o) { sendA(o); return keptA; }
let keptB;
function sendB(v) { const t = new EventTarget(); t.addEventListener("e", e => { keptB = e.detail; }); t.dispatchEvent(new CustomEvent("e", { detail: v })); }
function throughB(o) { sendB(o); return keptB; }
let keptC;
function sendC(v) { const t = new EventTarget(); t.addEventListener("e", e => { keptC = e.detail; }); t.dispatchEvent(new CustomEvent("e", { detail: v })); }
function throughC(o) { sendC(o); return keptC; }
let keptD;
function sendD(v) { const t = new EventTarget(); t.addEventListener("e", e => { keptD = e.detail; }); t.dispatchEvent(new CustomEvent("e", { detail: v })); }
function throughD(o) { sendD(o); return keptD; }
let keptE;
function sendE(v) { const t = new EventTarget(); t.addEventListener("e", e => { keptE = e.detail; }); t.dispatchEvent(new CustomEvent("e", { detail: v })); }
function throughE(o) { sendE(o); return keptE; }
let keptF;
function sendF(v) { const t = new EventTarget(); t.addEventListener("e", e => { keptF = e.detail; }); t.dispatchEvent(new CustomEvent("e", { detail: v })); }
function throughF(o) { sendF(o); return keptF; }
const a = new A(), b = new B(), c = new C(), d = new D(), e = new E(), f = new F();
console.log(showA(a), showB(b), showC(c), showD(d), showE(e), showF(f));
changeA(throughA(a)); changeB(throughB(b)); changeC(throughC(c)); changeD(throughD(d)); changeE(throughE(e)); changeF(throughF(f));
console.log(showA(a));
console.log(showB(b));
console.log(showC(c));
console.log(showD(d));
console.log(showE(e));
console.log(showF(f));
