// D.prototype = new B(..): what B's constructor does, what happens to the object afterwards, and who else holds it.
const out = [];
function attempt(label, body) { try { out.push(label + " " + body()); } catch (error) { out.push(label + " " + error.constructor.name); } }
function one(d) { const names = []; for (const name in d) names.push(name); return [d.n, d.i, d.step(), d.own(), names.join(".")].join(); }
function work(all, k) { let s = ""; for (let q = 0; q < k; q++) { const d = all[q & 1]; s += d.step() + String(d.own()) + d.n + ";"; } return s; }
function make(parent, child, change) {
  const { B, prototypeOf } = parent();
  const D = child(B);
  D.prototype = prototypeOf(B);
  D.prototype.own = function () { return "own" + this.get(); };
  const all = [new D(1), new D(2)];
  return [one(all[0]), work(all, 3), change(D, all, B), one(all[1]), work(all, 3)].join(" ");
}

function B(n) { this.n = n; this.i = 0; }
B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
B.prototype.get = function () { return this.n; };
function D(n) { this.n = n; this.i = 0; }
D.prototype = new B(0);
D.prototype.own = function () { return "D" + this.get(); };
const ds = [new D(1), new D(2)];
attempt("plain", () => ds.map(one).join(" ") + work(ds, 5));
attempt("prototype", () => [D.prototype instanceof B, D.prototype.n, D.prototype.i, D.prototype.constructor === B, Object.keys(D.prototype).join()].join());

function E(n) { if (n !== 2) this.n = n; }
E.prototype = new B("above");
E.prototype.own = function () { return "E" + this.get(); };
const es = [new E(1), new E(2)];
attempt("partly filled", () => es.map(one).join(" ") + work(es, 5));
attempt("stored above", () => { E.prototype.n = { valueOf() { return 7; } }; E.prototype.i = 0.5; return work(es, 4) + (es[1].n + 1); });
attempt("deleted above", () => { delete E.prototype.n; return String(es[1].n) + es[0].n; });

function F(n) { B.call(this, n); this.f = "f"; }
F.prototype = new B();
F.prototype.constructor = F;
F.prototype.own = function () { return "F" + this.get(); };
const fs = [new F(1), new F(2)];
attempt("called", () => fs.map(one).join(" ") + work(fs, 5));
attempt("frozen above", () => { Object.freeze(F.prototype); const f = new F(3); f.n = 4; return one(f) + one(fs[0]); });

const held = [];
function Leaking(n) { held.push(this); this.n = n; this.i = 0; }
Leaking.prototype.step = B.prototype.step;
Leaking.prototype.get = B.prototype.get;
function G(n) { this.n = n; this.i = 0; }
G.prototype = new Leaking(0);
G.prototype.own = function () { return "G" + this.get(); };
const gs = [new G(1), new G(2)];
attempt("leaked", () => { held[0].own = function () { return "leak"; }; held[0].step = function () { return -1; }; return gs.map(one).join(" ") + work(gs, 4); });

let last;
function Set(n) { this.n = n; this.i = 0; }
Object.defineProperty(Set.prototype, "n", { set(v) { last = this; this.m = v; }, get() { return "got" + this.m; } });
Set.prototype.step = B.prototype.step;
Set.prototype.get = B.prototype.get;
function H(n) { this.n = n; this.i = 0; }
H.prototype = new Set(0);
const ofH = last;
H.prototype.own = function () { return "H" + this.get(); };
const hs = [new H(1), new H(2)];
attempt("setter", () => { ofH.step = function () { return -2; }; return hs.map(one).join(" ") + work(hs, 4); });

function Grand(n) { this.n = n; this.i = 0; }
Grand.prototype = new D(5);
Grand.prototype.own = function () { return "Grand" + this.get(); };
const grands = [new Grand(1), new Grand(2)];
attempt("grand", () => grands.map(one).join(" ") + work(grands, 5) + (grands[0] instanceof B));

attempt("through an object", () => { const p = Object.getPrototypeOf(ds[0]); p.n = "through"; delete ds[0].n; return one(ds[0]) + work(ds, 4); });
attempt("called on the prototype", () => { D.prototype.step(); D.prototype.step(); delete ds[1].i; return ds[1].i + work(ds, 4); });
attempt("accessor above", () => { Object.defineProperty(D.prototype, "n", { get() { return "acc"; }, set(v) { this.hidden = v; } }); const d = new D(8); return one(d) + one(ds[1]); });
attempt("replaced", () => { D.prototype = new B(6); D.prototype.own = function () { return "again"; }; return one(new D(9)) + one(ds[1]); });
for (const n of [0, 1]) attempt("made", () => make(() => ({ B, prototypeOf: P => new P(n) }), P => function (q) { P.call(this, q); }, (C, all) => { C.prototype.n = "m"; delete all[1].n; return all.length; }));
console.log(out.join("\n"));
