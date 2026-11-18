const many = () => Array.from({ length: 24 }, (_, i) => ({ ["k" + i]: i, x: i }));
check(all => { let s = 0; for (let i = 0; i < all.length; i++) s += all[i].x; return s; }, () => [[many()], [[...many(), {}]], [[...many(), null]], [[...many(), { get x() { throw 1; } }]]]);
check(all => { for (let i = 0; i < all.length; i++) all[i].y = i; return all.at(-1); }, () => [[many()], [[...many(), Object.freeze({})]], [[...many(), { set y(v) { this.z = v; } }]]]);
check(all => { "use strict"; for (let i = 0; i < all.length; i++) all[i].y = i; }, () => [[many()], [[...many(), Object.freeze({})]]]);
check((o, k) => [o[k], k in Object(o), (o[k] = 1), o[k]], () => [[{ a: 1 }, "a"], [{ a: 1 }, "b"], [[1], "0"], [{}, Symbol.iterator], [{}, { toString: () => "t" }], ["s", "length"], [null, "a"]]);
check(o => "x" in o, () => [[{ x: 1 }], [{}], [Object.create({ x: 1 })], [new Proxy({}, { has: () => true })], [1]]);
class Base { constructor(v) { this._v = v; } get v() { return this._v + 1; } set v(n) { this._v = n * 2; } m() { return "base"; } }
class Left extends Base { m() { return super.m() + super.v; } }
class Right extends Base { get v() { return new Error().stack.split("\n").length > 1; } m() { return 7; } }
globalThis.instances = () => [[new Base(1)], [new Left(0.5)], [new Right("x")], [new Base("s")], [new Base({ valueOf() { throw 2; } })], [{ v: 3, m: Math.random.bind }]];
check(o => o.v, instances);
check(o => { o.v = 4; return o._v; }, instances);
check(o => { o.v = o._v; return o._v; }, instances);
check(o => { try { return o.v; } catch (e) { return -e; } }, instances);
check(all => all.map(o => o.m()).join(), () => [[[new Base(1), new Left(2)]], [[new Base(1), new Left(2), new Right(3)]], [[new Base(1), { m: () => 0.5 }]], [[new Base(1), { m: 1 }]]]);
check(n => n.toString(), singles);
const read = all => { let s = []; for (const o of all) { const a = o.x; o.other = 1; s.push(a, o.x); } return s.slice(-4); };
check(read, () => [[many()], [[...many(), {}]], [[...many(), Object.create({ x: 5 })]], [[...many(), { get x() { return this.other; } }]], [[...many(), new Proxy({}, { get: () => 7 })]], [[...many(), [1]]], [[...many(), "s"]], [[...many(), Math]]]);
check(all => { let s = 0; for (const o of all) { const p = { x: 1 }; delete o.x; Object.setPrototypeOf(o, p); s += o.x; p.x = 2; s += o.x; } return s; }, () => [[many()]]);
check((all, p) => { let s = 0; for (const o of all) { s += o.x; p.x = 3; s += o.x; } return s; }, () => { const p = { x: 1 }, q = many(); return [[many(), {}], [[...many(), Object.create(p)], p], [q, q[3]]]; });
check(all => { for (const o of all) { o.a = 1; o.b = o.a + 1; o.c = o.b + 1; o.d = {}; o.e = 5; o.f = 6; o.g = o.d; o.x = o.c; } return all.at(-1); }, () => [[many()], [[...many(), Object.preventExtensions({ a: 0 })]], [[...many(), Object.create({ set b(v) {} })]], [[...many(), Object.create(Object.freeze({ c: 9 }))]], [[...many(), []]], [[...many(), () => 1]]]);
globalThis.init = function (v) { this.p = v; this.q = this.p + 1; this.r = this.m(); this.s = this.none; this.t = v; };
globalThis.kinds = Array.from({ length: 12 }, (_, i) => Object.assign(function (v) { this["k" + i] = i; init.call(this, v); }, { prototype: { m: () => i } }));
kinds.forEach(K => { for (let i = 0; i < 9; i++) new K(i); });
check(v => { function K(v) { init.call(this, v); } K.prototype = kinds[1].prototype; return new K(v); }, singles);
check((v, change) => { const K = kinds[2], undo = change(K.prototype), made = new K(v); undo(); return made; }, () => [[1, () => () => {}], [2, p => { const { m } = p; p.m = () => 0.5; return () => { p.m = m; }; }], [3, p => { p.none = 1; return () => delete p.none; }], [4, p => { Object.defineProperty(p, "t", { set() {}, configurable: true }); return () => delete p.t; }]]);
globalThis.exported = Object.defineProperty({}, "v", { get: () => globalThis.current, configurable: true });
check(v => { globalThis.current = v; return [exported.v, globalThis.current, exported.__proto__ === Object.prototype]; }, singles);
check(o => o.x, () => [[{ x: 1 }], [{ y: 1, x: 2 }], [{ get x() { return 3; } }], [[]], [1], ["s"], [null], [globalThis]]);
globalThis.put = (o, v) => { o.x = v; };
many().slice(0, 8).forEach(({ x }, i) => { for (let k = 0; k < 4; k++) put({ x, ["n" + i]: 1 }, k); });
check((c, d) => { const o = c === 0 ? { x: 1, n0: 1 } : c === 1 ? { x: 2, q: 0 } : { y: 1, z: 3 }; if (d) put(o, 5); return o; }, () => [[0, true], [1, false], [2, false], [1, true], [2, true]]);
class Plain extends Base {}
check((all, f) => all.map(o => o.m(f(o))).join(), () => [[[new Base(1), new Left(2), new Right(3), new Plain(4)], o => 0], [[new Left(2), new Right(3)], o => { o.extra = 1; }], [[new Base(1), new Left(2)], o => Object.setPrototypeOf(o, Right.prototype)]]);
class First { constructor() { this.x = 1; this.y = 2; } m() { return this.y; } }
class Second { constructor() { this.y = 3; } m() { return this.y; } }
globalThis.rearrange = new Function("o", "with (o) { delete o.y; o.z = 'z'; }");
checkInTurn((o, n) => { const { m } = o; let r; for (let i = 0; i < n; i++) { r = m.call(o); rearrange(o); } return r; }, () => [[new First(), 1], [new Second(), 1], [new First(), 2], [new Second(), 2]], 30);
