// What a constructor and the methods that it calls off its object fill before anybody else sees the object, and what somebody may see empty.
const out = [], held = [];
function attempt(label, body) { try { out.push(label + " " + body()); } catch (error) { out.push(label + " " + error.constructor.name); } }
const show = o => Object.keys(o).join() + ":" + Object.values(o).map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join();
function peek(o) { held.push(Object.keys(o).join() + o.s); }

function plain(P) {
  P.prototype.more = function (n) { this.m = n; this.t = "m"; };
  P.prototype.work = function () { let r = 0; for (let i = 0; i < 4; i++) { r += i; if (typeof this.s === "number") this.s += i; this.t = this.t; } return r + String(this.s) + this.t; };
  return P;
}
const bodies = {
  plain: { late(n) { this.s = 0; this.t = n; } },
  some: { late(n) { this.s = 0; if (n > 1) this.t = n; } },
  arms: { late(n) { if (n > 1) { this.s = n; this.t = 1; } else { this.t = 2; this.s = "s"; } } },
  early: { late(n) { this.s = 0; if (n === 2) return; this.t = n; } },
  reads: { late(n) { this.t = this.a; this.s = typeof this.s; } },
  leaks: { late(n) { this.s = 0; held.push(this); held[0].t = held.length; this.t = n; } },
  peeks: { late(n) { this.s = 0; peek(this); this.t = n; } },
  chained: { late(n) { this.s = 0; this.t = n; return this; } },
};

function A(n) { this.a = n; this.late(n); this.z = n; }
A.prototype.late = function (n) { this.s = 0; this.t = n; };
plain(A);
attempt("around", () => { const all = [0, 1, 2].map(n => new A(n)); return all.map(show).join(" ") + all.map(o => o.work()).join() + all.map(show).join(" "); });

function B(n) { this.late(n); this.a = n; }
B.prototype.late = function (n) { this.t = this.a; this.s = n; };
plain(B);
attempt("reads empty", () => { const all = [0, 1].map(n => new B(n)); return all.map(show).join(" ") + all.map(o => o.work()).join(); });

function C(n) { if (n !== 1) this.late(n); else this.more(n); this.a = n; }
C.prototype.late = function (n) { this.s = 0; this.t = n; };
plain(C);
attempt("either", () => { const all = [0, 1, 2].map(n => new C(n)); return all.map(show).join(" ") + all.map(o => o.work()).join(); });

function D(n) { held.push(this); this.late(n); }
D.prototype.late = function (n) { this.s = held[held.length - 1].t; this.t = n; };
plain(D);
attempt("seen first", () => { const all = [0, 1].map(n => new D(n)); return all.map(show).join(" ") + all.map(o => o.work()).join(); });

function E(n) { try { this.late(n); } catch (error) { this.e = error.message; } this.a = n; }
E.prototype.late = function (n) { this.s = 0; if (n === 1) throw new Error("one"); this.t = n; };
plain(E);
attempt("caught", () => { const all = [0, 1, 2].map(n => new E(n)); return all.map(show).join(" ") + all.map(o => o.work()).join(); });

function F(n) { for (let q = 0; q < n; q++) this.late(q); }
F.prototype.late = function (n) { this.s = (this.s | 0) + 1; this.t = n; };
plain(F);
attempt("loop", () => { const all = [0, 1, 3].map(n => new F(n)); return all.map(show).join(" ") + all.map(o => o.work()).join(); });

function G(n) { this.late(n); return n === 1 ? { s: "other", t: 0 } : undefined; }
G.prototype.late = function (n) { this.s = 0; this.nested(n); };
G.prototype.nested = function (n) { this.t = n; };
plain(G);
attempt("nested", () => { const all = [0, 1, 2].map(n => new G(n)); return all.map(show).join(" "); });

class H { constructor(n) { this.late(n); this.a = n; } late(n) { this.s = 0; this.t = n; } work() { this.s += 2; return this.s + this.t; } }
class I extends H { late(n) { this.other = n; } }
attempt("heir", () => { const h = new H(1), i = new I(2); return show(h) + h.work() + show(h) + show(i) + i.work() + show(i); });

class J { x = 1; constructor(n) { this.late(n); } late(n) { this.s = this.x; this.t = this.y; } y = 2; work() { this.s += 2; return this.s + this.t; } }
attempt("fields", () => { const j = new J(1); return show(j) + j.work() + show(j); });

function K(n) { this.late(n); }
K.prototype.late = function (n) { this.s = n; this.t = 0; };
plain(K);
attempt("replaced", () => { const first = new K(1); K.prototype.late = function (n) { this.u = n; }; const second = new K(2); return [first, second].map(o => show(o) + o.work() + o.s).join(" "); });

function L(n) { this.late(n); }
L.prototype.late = function (n) { this.s = n; this.t = n; };
plain(L);
Object.defineProperty(L.prototype, "t", { set(v) { this.hidden = v; held.push(this.s); }, get() { return "got" + this.hidden; } });
attempt("setter", () => { const l = new L(3); return show(l) + l.work(); });

for (const name in bodies) {
  function M(n) { this.a = n; this.late(n); }
  Object.assign(M.prototype, bodies[name]);
  plain(M);
  attempt(name, () => { const all = [0, 1, 2].map(n => new M(n)); return all.map(show).join(" ") + all.map(o => o.work()).join() + all.map(show).join(" "); });
}
attempt("deleted", () => { const a = new A(5); delete a.s; const b = show(a) + ("s" in a); a.late(6); return b + show(a) + a.work(); });
attempt("held", () => held.length + held.map(h => typeof h === "object" ? show(h) : String(h)).join(" "));
console.log(out.join("\n"));
