// Instances whose prototype is not the one their constructor's class names: Reflect.construct, bound and proxied constructors, factories, new.target without a prototype object.
class K { a = 1; b = "two"; constructor(c) { this.c = c; } sum() { return this.a + this.b + this.c; } }
function show(o) { return [Object.keys(o).join(), o.a, o.b, o.c, typeof o.sum, o instanceof K, Object.getPrototypeOf(o) === K.prototype].join(" "); }
console.log(show(new K(3)));
function Other() {} Other.prototype.sum = function () { return "other" + this.a; };
const r1 = Reflect.construct(K, [3], Other); console.log(show(r1), r1.sum(), r1 instanceof Other);
function NoProto() {} NoProto.prototype = 5; const r2 = Reflect.construct(K, [3], NoProto); console.log(show(r2), Object.getPrototypeOf(r2) === Object.prototype);
const Bound = K.bind(null, 9); const r3 = new Bound(); console.log(show(r3), r3.sum());
const Prox = new Proxy(K, {}); const r4 = new Prox(4); console.log(show(r4), r4.sum());
const Prox3 = new Proxy(K, { construct(t, a) { return { fake: true }; } }); console.log(JSON.stringify(new Prox3(1)));
const make = B => class extends B { d = 4; sum() { return "sub" + super.sum() + this.d; } };
const S1 = make(K), S2 = make(K); const r6 = new S1(6), r7 = new S2(7); console.log(show(r6), r6.sum(), r7.sum(), r6 instanceof S2, Object.keys(r6).join());
const S3 = make(make(K)); console.log(new S3(8).sum(), Object.keys(new S3(8)).join());
class L extends K {} Object.setPrototypeOf(L, class { constructor() { this.z = 26; } }); const r8 = new L(1); console.log(JSON.stringify(r8), r8 instanceof K, typeof r8.sum);
class M extends K {} Object.setPrototypeOf(M.prototype, Other.prototype); const r9 = new M(2); console.log(show(r9), r9.sum());
const saved = K.prototype.sum; K.prototype.sum = function () { return "patched" + this.c; }; console.log(new K(1).sum(), r6.sum()); K.prototype.sum = saved;
function F(x) { this.x = x; } F.prototype.get = function () { return this.x; }; const f1 = new F(1); F.prototype = { get() { return "second" + this.x; } }; const f2 = new F(2); console.log(f1.get(), f2.get(), f1 instanceof F, f2 instanceof F);
function G() { return new.target === undefined ? "call" : new.target === G ? "new" : "derived"; } console.log(G(), typeof new G(), typeof Reflect.construct(G, [], Other));
class N { constructor() { this.t = new.target.name; } } class N2 extends N {} console.log(new N().t, new N2().t, Reflect.construct(N, [], Other).t);
const many = []; for (const C of [K, S1, M, Bound, Prox]) many.push(new C(1)); let total = ""; for (const o of many) total += o.a + o.c; console.log(total);
const o10 = new K(1); Object.setPrototypeOf(o10, null); console.log(o10.a, o10.sum, Object.keys(o10).join());
const o11 = new K(1); o11.__proto__ = Other.prototype; console.log(o11.sum(), o11 instanceof K);
const o12 = Object.create(K.prototype); console.log(show(o12), String(o12.sum()));
const o13 = Object.create(new K(13)); o13.a = 100; console.log(o13.sum(), Object.keys(o13).join(), o13.b);
const o14 = Object.setPrototypeOf({ a: 5, b: 6, c: 7 }, K.prototype); console.log(o14.sum(), o14 instanceof K);
