const attempt = f => { try { return f(); } catch (e) { return `${e.name}: ${e.message}`.slice(0, 60); } };
class A { constructor(x) { this.x = x; } own() { return this.x; } }
A.prototype.method = function (y) { return this.x + y; };
A.prototype.level = 7; A.prototype.list = [1, 2, 3]; A.prototype.name = "default"; A.prototype.nothing = undefined; A.prototype.half = 0.5;
A.prototype[Symbol.toStringTag] = "Tagged"; A.prototype[Symbol.iterator] = function* () { yield this.x; yield this.level; };
A.prototype.alias = A.prototype.own; Object.assign(A.prototype, { twice() { return this.x * 2; }, flag: true });
Object.defineProperty(A.prototype, "area", { get() { return this.x * 10; }, set(v) { this.x = v; }, configurable: true });
Object.defineProperties(A.prototype, { fixed: { value: 11 }, own: { enumerable: true } });
class B extends A { own() { return super.own() + 1; } up() { return this.method(1) + this.level + super.twice(); } }
B.prototype.level = 9; B.prototype.only = function () { return this.alias() + this.fixed; };
class C extends B { }
function read(o) { return o.method(2) + o.level + o.list[1] + o.name.length + o.half + o.alias() + o.twice() + o.fixed + (o.flag ? 1 : 0) + o.area + o.own() + (o.nothing === undefined ? 1 : 0) + (o.missing === undefined ? 1 : 0); }
const all = [new A(1), new B(2), new C(3), new A(4)]; all[3].level = 100; all[3].name = "own"; all[2].method = function () { return 1000; };
let s = 0; for (let i = 0; i < 400; i++) { const o = all[i & 3]; o.area = i & 7; s = (s * 3 + read(o) * 2) | 0; if (o.only) s += o.only() + o.up(); for (const x of o) s += x; }
console.log("all", s, String(all[0]), Object.keys(all[3]).join(), [...all[1]].join()); { const names = []; for (const n in all[0]) names.push(n); console.log(names.join()); }
console.log(Object.keys(A.prototype).join(), Object.getOwnPropertyNames(B.prototype).join());
function call(o) { return o.method(5); } function level(o) { return o.level; }
s = 0; for (let i = 0; i < 200; i++) s += call(all[i & 3]) + level(all[i & 3]); console.log("calls", s);
A.prototype.method = function (y) { return -y; }; A.prototype.level = "text"; B.prototype.level = { deep: 1 };
s = ""; for (let i = 0; i < 8; i++) s += call(all[i & 3]) + String(level(all[i & 3])); console.log("stored over", s);
delete B.prototype.level; delete A.prototype.alias; s = ""; for (let i = 0; i < 8; i++) s += String(level(all[i & 3])) + attempt(() => all[i & 3].alias()); console.log("deleted", s);
Object.defineProperty(A.prototype, "level", { get() { return this.x + 1000; }, configurable: true }); s = 0; for (let i = 0; i < 100; i++) s += level(all[i % 3]); console.log("getter", s, attempt(() => { "use strict"; all[0].level = 1; }));
A.prototype.own = function () { return 5000; }; s = 0; for (let i = 0; i < 100; i++) s += all[i & 3].own(); console.log("declared", s);
const moved = Object.setPrototypeOf(new A(6), { level: 1, method: y => y }); console.log("moved", moved.level, moved.method(3), attempt(() => moved.twice()), moved.fixed);
Object.setPrototypeOf(B.prototype, { get level() { return "above"; }, own() { return "o"; } }); console.log("rows", attempt(() => all[1].level), attempt(() => all[1].own()), attempt(() => all[1].up()), attempt(() => all[2].only()));
class D { x = 1; } const proto = D.prototype; proto.late = 3; const d = new D(); proto["dyn" + "amic"] = 4; for (const k of ["p", "q"]) proto[k] = k + "!"; console.log("names", d.late, d.dynamic, d.p, d.q, Object.keys(proto).join()); proto.late = () => 9; console.log(d.late());
class E { run() { return this.step(1); } step(x) { return x; } } E.prototype.step = function (x) { return x * 100; }; const e = new E(); s = 0; for (let i = 0; i < 200; i++) s += e.run() + e.step(i); console.log("step", s); const former = E.prototype.run; E.prototype.run = function () { return former.call(this) + 1; }; s = 0; for (let i = 0; i < 200; i++) s += e.run(); console.log("wrapped", s);
class F { constructor() { this.seen = 0; } } F.prototype.seen = 5; F.prototype.other = 6; F.prototype.count = 0; const f = new F(); f.count++; f.count += 2; F.prototype.count = 50; console.log("shadow", f.seen, f.other, f.count, new F().count, Object.keys(f).join());
class G { } Object.freeze(G.prototype); console.log("frozen", attempt(() => { "use strict"; G.prototype.x = 1; }), attempt(() => { const g = new G(); g.toString = 1; return Object.keys(g).join(); }), new G().x);
class H { } H.prototype.k = 1; Object.freeze(H.prototype); console.log(attempt(() => { const h = new H(); h.k = 2; return h.k; }), new H().k);
class I { get v() { return 1; } } attempt(() => { I.prototype.v = 5; }); I.prototype.w = 2; class J extends I { } J.prototype.v2 = 3; console.log("accessor", new I().v, new I().w, new J().v, new J().w, new J().v2, attempt(() => { J.prototype.v = 9; return new J().v; }));
class K { constructor() { return Object.create(K.prototype); } } K.prototype.z = 8; console.log("made", new K().z, new K() instanceof K); const borrowed = { __proto__: K.prototype }; console.log(borrowed.z, K.prototype.isPrototypeOf(borrowed));
function store(o, k, v) { o[k] = v; } class L { } store(L.prototype, "m", function () { return this.n; }); store(L.prototype, "n", 4); console.log("helper", new L().m(), new L().n); const wrap = (K2, n, g) => { const was = K2.prototype[n]; K2.prototype[n] = function (...a) { return g(was.apply(this, a)); }; }; class M { m(x) { return x; } } M.prototype.extra = 1; wrap(M, "m", x => x * 7); console.log(new M().m(3), new M().extra);
