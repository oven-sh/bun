const out = [];
const tell = (f) => { try { out.push(String(f())); } catch (error) { out.push(error.constructor.name); } };
class A { constructor(x) { this.x = x; } total() { return this.x; } }
class B extends A { constructor(x) { super(x); this.y = x; } get own() { return this.y; } }
const before = new A(1), below = new B(2);
let stored = 0;
tell(() => [before.late, below.late, "late" in below]);
tell(() => Object.defineProperty(A.prototype, "late", { get() { return this.x + 1; }, set(v) { stored = v; }, configurable: true }) === A.prototype);
tell(() => [before.late, below.late, new B(5).late]);
tell(() => { before.late = 7; below.late = 8; return [stored, Object.keys(before), Object.keys(below)].join("|"); });
tell(() => { class C extends B { get late() { return "own " + super.late; } } return new C(1).late; });
tell(() => { class D extends A { constructor() { super(1); Object.defineProperty(this, "late", { value: 9 }); } } return new D().late; });
tell(() => { class E extends A { late = 10; } return new E(1).late; });
tell(() => Object.defineProperty(A.prototype, Symbol.toStringTag, { value: "Tagged" }) && [String(before), Object.prototype.toString.call(below)]);
tell(() => Object.defineProperty(A.prototype, Symbol.iterator, { value: function* () { yield this.x; yield 2; } }) && [...below]);
tell(() => Object.defineProperty(A.prototype, "fixed", { value: 3 }) && [before.fixed, below.fixed]);
tell(() => { below.fixed = 4; return below.fixed; });
tell(() => Object.defineProperty(A.prototype, "total", { value: () => "replaced", configurable: true }) && [before.total(), below.total()]);
tell(() => Object.defineProperty(B.prototype, "own", { get: () => "other" }) && below.own);
tell(() => Object.defineProperty(A.prototype, "x", { get: () => "above" }) && [before.x, new A(6).x]);
tell(() => Object.defineProperties(B.prototype, { one: { get() { return this.x; }, enumerable: true }, two: { value: 2, enumerable: true } }) && [below.one, below.two]);
tell(() => { const seen = []; for (const name in below) seen.push(name); return seen; });
tell(() => delete A.prototype.late && [before.late, below.late]);
tell(() => Object.defineProperty(A.prototype, "late", { get: () => "again" }) && [before.late, below.late]);
tell(() => Object.defineProperty(A.prototype, "late", { get: () => "twice" }));
tell(() => { let s = 0; for (let i = 0; i < 40; i++) s += new B(i).one + below.two; return s; });
tell(() => Reflect.defineProperty(Object.freeze(B.prototype), "three", { value: 3 }));
tell(() => [below.three, Object.getOwnPropertyNames(B.prototype)]);
console.log(out.join("\n"));
