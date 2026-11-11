const attempt = f => { try { return f(); } catch (e) { return `${e.name}: ${e.message}`.slice(0, 70); } };
class B { #x; b = 1; constructor(x) { this.#x = x; } base() { return this.#x; } static has(o) { return #x in o; } }
class C extends B { #y; #z = 3; constructor(x, y) { super(x); this.#y = y; } both() { return this.base() + this.#y + this.#z; } static has(o) { return #y in o; } static peek(o) { return o.#z; } }
class D extends C { #w = this.both(); late = 2; #v; constructor(x) { super(x, x + 1); this.#v = this.#w * 2; } all() { return this.#w + this.#v + this.late; } }
let s = 0; for (let i = 0; i < 400; i++) { const d = new D(i), c = new C(i, 2); s = (s * 3 + d.all() + c.both() + (C.has(d) ? 1 : 0) + (B.has(c) ? 2 : 0) + C.peek(d)) | 0; }
console.log("chain", s, Object.keys(new D(1)).join(), C.has({}), attempt(() => C.peek(new B(1))));
class Given { constructor(o) { return o; } }
class Stamp extends Given { #mark = 1; #more; constructor(o, m) { super(o); this.#more = m; } static read(o) { return #mark in o ? o.#mark + o.#more : "none"; } static bump(o) { o.#mark++; } }
const plain = {}, list = [1], frozen = Object.freeze({}), c = new C(1, 2), sealed = Object.preventExtensions([2]);
for (const o of [plain, list, c, {}, function () {}, new Map(), frozen, sealed]) console.log(attempt(() => { new Stamp(o, 5); return Stamp.read(o); }), attempt(() => { new Stamp(o, 6); return "again"; }), attempt(() => Stamp.read(o)));
s = 0; for (let i = 0; i < 300; i++) { const o = i & 1 ? { a: i } : [i]; new Stamp(o, i); Stamp.bump(o); s = (s + Stamp.read(o)) | 0; } console.log("stamp", s);
function made(n) { class P { #a = n; get a() { return this.#a; } } class Q extends P { #b = this.a + 1; get b() { return this.#b; } } return [new Q(), Q]; }
s = 0; for (let i = 0; i < 200; i++) { const [q] = made(i); s += q.a + q.b; } console.log("made", s);
class Throws extends B { #t = (() => { if (this.base() > 3) throw new RangeError("t"); return 1; })(); t() { return this.#t; } }
s = 0; for (let i = 0; i < 100; i++) s += attempt(() => new Throws(i % 6).t()) === 1 ? 1 : 100; console.log("throws", s);
class Early extends B { constructor() { try { super(Early.read(undefined)); } catch (e) { super(0); } } #e = 4; static read(o) { return o.#e; } e() { return this.#e; } }
s = 0; for (let i = 0; i < 50; i++) s += new Early().e(); console.log("early", s);
class Twice extends B { #q = 1; constructor(o) { super(1); } again() { return attempt(() => Reflect.construct(Again, [this], Twice)); } } class Again extends Given { #q = 2; get q() { return this.#q; } static q(o) { return o.#q; } }
{ const t = new Twice(); t.again(); console.log("twice", Again.q(t), t.again(), B.has(t)); }
class Accessor extends B { #m() { return this.base() * 2; } get #g() { return this.#m() + 1; } set #g(v) { this.b = v; } go(v) { this.#g = v; return this.#g + this.b; } }
s = 0; for (let i = 0; i < 200; i++) s += new Accessor(i).go(i); console.log("accessor", s);
class OfArray extends Array { #n = 7; n() { return this.#n + this.length; } } class OfMap extends Map { #n = 8; n() { return this.#n + this.size; } }
s = 0; for (let i = 0; i < 100; i++) s += new OfArray(1, 2, 3).n() + new OfMap([[i, i]]).n(); console.log("builtin", s);
