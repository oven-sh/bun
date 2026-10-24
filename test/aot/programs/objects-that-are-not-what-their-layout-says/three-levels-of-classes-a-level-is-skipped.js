function probe(label, run) { let text; try { const v = run(); text = typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { text = "threw " + e.constructor.name; } console.log(label + " " + text); }
class A { #p = 7.5; constructor(seed) { this.n = seed + 0.5; this.i = seed | 0; } sum() { return this.n + this.i; } getP() { return this.#p; } }
class M extends A { #m = 1.5; w = 4.5; constructor(seed) { super(seed); this.s = "s" + seed; this.o = { k: seed }; } len() { return this.s.length; } deep() { return this.o.k; } getM() { return this.#m; } }
class S extends A { #z = 2.5; u = "sibling"; constructor(seed) { super(seed); this.r = seed * 2 + 0.5; } getZ() { return this.#z; } }
class B extends M { #y = 3.5; x = 1.25; constructor(seed) { super(seed); this.t = "t" + seed; this.q = { z: seed }; } more() { return this.x + this.n; } wide() { return this.t.length + this.s.length; } under() { return this.q.z + this.o.k + this.w; } getY() { return this.#y; } }
function hot(v) { return v.n * 2 + v.i + v.s.length + v.o.k + v.w + v.x + v.t.length + v.q.z + v.sum() + v.len() + v.deep() + v.more() + v.wide() + v.under() + v.getP() + v.getM() + v.getY(); }
function readAll(name, v) { for (const key of ["n", "i", "s", "o", "w", "x", "t", "q", "u", "r"]) probe(name + " " + key, () => v[key]);
  probe(name + " n+1", () => v.n + 1); probe(name + " w+1", () => v.w + 1); probe(name + " s.length", () => v.s.length); probe(name + " o.k", () => v.o.k); probe(name + " x+1", () => v.x + 1); probe(name + " t.length", () => v.t.length); probe(name + " q.z", () => v.q.z);
  for (const m of ["sum", "len", "deep", "more", "wide", "under", "getP", "getM", "getY"]) probe(name + " " + m, () => v[m]());
  probe(name + " getZ", () => S.prototype.getZ.call(v)); probe(name + " hot", () => hot(v)); probe(name + " keys", () => Object.keys(v).join()); probe(name + " is", () => [v instanceof A, v instanceof M, v instanceof S, v instanceof B].join()); }
const honest = [new B(1), new B(2)]; let warm = 0; for (let turn = 0; turn < 300; turn++) for (const each of honest) warm += hot(each); console.log("warm " + warm); new S(1); new M(1);
Object.setPrototypeOf(B, A); readAll("a level is skipped", new B(3)); Object.setPrototypeOf(B, M);
readAll("honest", honest[0]); readAll("fresh", new B(6));
