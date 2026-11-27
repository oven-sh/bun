// #name in object: every kind of name and of object, asked again and again in loops, so that what the run time has remembered answers too.
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, r); };
const ask = (has, objects) => { let s = ""; for (let i = 0; i < 60; i++) { let r; try { r = has(objects[i % objects.length]) ? 1 : 0; } catch (e) { r = e.name[0]; } if (i >= 60 - objects.length) s += r; } return s; };
class A { #x = 1; #y; #m() { return 1; } get #g() { return 2; } static #s = 3; static #sm() { return 4; }
  static x(o) { return #x in o; } static y(o) { return #y in o; } static m(o) { return #m in o; } static g(o) { return #g in o; } static s(o) { return #s in o; } static sm(o) { return #sm in o; }
  fill() { this.#y = this.#x; return this; } }
class B extends A { z = 1; } class C extends B { #x = 5; static c(o) { return #x in o; } }
class D { #x = 1; static d(o) { return #x in o; } }
const others = () => [new A(), new B(), new C(), new D(), {}, { x: 1 }, [], [1, 2], new Map(), new Set(), function () {}, () => 1, A, B, class { }, Object.create(null), Object.create(new A()), new Proxy(new A(), {}), new Date(0), /x/, new Error("x"), new Uint8Array(2), Symbol, Math, Promise.resolve(1), new (class extends Map { })(), new (class extends Array { })(), Object(3), Object("x"), new WeakMap(), globalThis];
for (const name of ["x", "y", "m", "g", "s", "sm"]) show(name, () => ask(A[name], others()));
show("heir's own", () => ask(C.c, others())); show("other class", () => ask(D.d, others()));
show("primitives", () => ask(A.x, [1, "x", true, null, undefined, Symbol("s"), 3n]));
show("filled", () => ask(A.y, [new A().fill(), new B().fill()]));
show("frozen", () => ask(A.x, [Object.freeze(new A()), Object.freeze({}), Object.seal(new B())]));
show("extra property", () => { const a = new A(), o = {}; a.q = 1; o.q = 1; return ask(A.x, [a, o]); });
show("many extra", () => { const a = new A(); for (let i = 0; i < 70; i++) a["p" + i] = i; const o = {}; for (let i = 0; i < 70; i++) o["p" + i] = i; return ask(A.x, [a, o]); });
show("relinked", () => { const a = new A(); Object.setPrototypeOf(a, null); const o = {}; Object.setPrototypeOf(o, A.prototype); return ask(A.x, [a, o]); });
show("evaluated twice", () => { const make = () => class { #x = 1; static x(o) { return #x in o; } }; const X = make(), Y = make(), x = new X(), y = new Y(); return [ask(X.x, [x, y]), ask(Y.x, [x, y])].join(" "); });
show("evaluated in a loop", () => { let s = ""; const os = []; let last; for (let i = 0; i < 5; i++) { class E { #x = i; static x(o) { return #x in o; } } os.push(new E()); last = E; } return ask(last.x, os); });
show("before the field", () => { const seen = []; class P { constructor() { seen.push(Q.x(this)); } } class Q extends P { #x = 1; constructor() { super(); seen.push(Q.x(this)); } static x(o) { return #x in o; } } for (let i = 0; i < 30; i++) new Q(); return seen.slice(-4).join(); });
show("between the fields", () => { const seen = []; class Q { #a = seen.push(Q.b(this)); #b = seen.push(Q.b(this)); #c = seen.push(Q.b(this)); static b(o) { return #b in o; } } for (let i = 0; i < 30; i++) new Q(); return seen.slice(-3).join(); });
show("on what the base answers", () => { let given; class P { constructor() { return given; } } class Q extends P { #x = 1; static x(o) { return #x in o; } } const os = []; for (const o of [{}, [], function () {}, new Map(), new A(), new D(), Object.create(null), new Proxy({}, {})]) { given = o; new Q(); os.push(o); } return ask(Q.x, [...os, {}, [], new A(), new Map(), new D()]); });
show("on a list then not", () => { let given; class P { constructor() { return given; } } class Q extends P { #x = 1; static x(o) { return #x in o; } } const a = [1], b = [1]; let s = ask(Q.x, [a, b]); given = a; new Q(); s += ask(Q.x, [a, b]); given = b; new Q(); return s + ask(Q.x, [a, b, [1]]); });
show("on an instance then not", () => { let given; class P { constructor() { return given; } } class Q extends P { #x = 1; static x(o) { return #x in o; } } const a = new D(), b = new D(); let s = ask(Q.x, [a, b]); given = a; new Q(); s += ask(Q.x, [a, b]); given = b; new Q(); return s + ask(Q.x, [a, b, new D()]); });
show("many classes", () => { const cs = []; for (let i = 0; i < 12; i++) cs.push(class { #x = i; static x(o) { return #x in o; } }); const os = cs.map(K => new K()); return cs.map(K => ask(K.x, os).indexOf("1")).join(); });
show("many structures", () => { const os = []; for (let i = 0; i < 40; i++) { const o = {}; o["k" + i] = i; os.push(o); if (i % 5 === 0) os.push(new A()); } let n = 0; for (let j = 0; j < 20; j++) for (const o of os) n += A.x(o) ? 1 : 0; return n; });
show("equals", () => { class V { #a; #b; constructor(a, b) { this.#a = a; this.#b = b; } equals(o) { return typeof o === "object" && o !== null && #a in o && o.#a === this.#a && o.#b === this.#b; } } const vs = [new V(1, 2), new V(1, 2), new V(3, 4), {}, null, [1], 5]; let s = 0; for (let i = 0; i < 700; i++) s += vs[0].equals(vs[i % 7]) ? 1 : 2; return s; });
show("builtin heirs", () => { class M extends Map { #x = 1; static x(o) { return #x in o; } } class L extends Array { #x = 1; static x(o) { return #x in o; } } class E extends Error { #x = 1; static x(o) { return #x in o; } } return [M, L, E].map(K => ask(K.x, [new K(), new M(), new L(), new E(), new Map(), [], new Error("x")])).join(" "); });
