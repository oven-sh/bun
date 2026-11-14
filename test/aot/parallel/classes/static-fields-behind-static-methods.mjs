// A loop that reads static methods keeps the static fields of the class in registers: through heirs, inner names, deletes, accessors, other parents, replaced methods.
class A { static count = 0; static made = 0; static make(n) { A.count = n; return new this(n); } static set(n) { A.count = n; } static get() { return this.count; } static step() { A.made++; return A.made; } constructor(n) { this.n = n; } }
class B extends A {} class C extends B { static own = 2; static get() { return -this.count; } }
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
function heir(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += B.make(k & 3).n + B.count; } return n; }
function own(turns) { let n = 0; for (let k = 0; k < turns; k++) { A.set(k & 3); n += A.count; } return n; }
function far(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += C.make(k & 7).n + C.count + C.own + C.get() + B.get(); } return n; }
function stepped(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += B.step() + C.made; } return n; }
function read(turns) { let x, n = 0; for (let k = 0; k < turns; k++) { x = B.set; x(k); n += B.count; } return n + typeof x; }
function large(turns) { let n = 3000000000; for (let k = 0; k < turns; k++) { n += B.make(k & 3).n + B.count; } return n; }
const show = label => console.log(label, attempt(() => heir(30)), attempt(() => own(30)), attempt(() => far(30)), attempt(() => stepped(9)), attempt(() => read(9)), attempt(() => large(30)), attempt(() => A.count), attempt(() => B.count), attempt(() => C.count));
show("as written"); show("again");
A.count = "t"; show("text"); A.count = 0.5; show("fraction"); A.count = { valueOf() { A.made += 10; return 2; } }; show("object"); A.made = 2147483640; show("near int32"); A.made = 0;
B.count = 100; show("own on the heir"); delete B.count; show("deleted"); C.count = undefined; show("own below"); delete C.count;
let reads = 0; Object.defineProperty(B, "count", { get() { reads++; return reads & 1 ? 4 : "a"; }, configurable: true }); show("accessor"); delete B.count; show("accessor deleted");
const set = A.set; A.set = function (n) { A.count = n + 1; }; show("method replaced"); delete A.set; show("method deleted"); A.set = set; show("method back");
Object.setPrototypeOf(B, { make: A.make, set, get: A.get, step: A.step, count: "parent", made: 1 }); show("other parent"); Object.setPrototypeOf(B, A); show("back");
delete A.count; show("deleted at the base"); A.count = 3; show("laid again");
Object.defineProperty(A, "count", { get() { reads += 10; return 7; }, set(v) { reads += 100; }, configurable: true }); show("accessor at the base");
console.log(reads, Object.keys(A).join(), Object.keys(B).join(), Object.keys(C).join());
