// Classes below mixins bound functions and proxies are constructed for each other.
{
  console.log("bound and proxy over siblings below function");
  function C() {
    this.x = 1;
  }
  class D extends C {
    d = 1;
  }
  class T extends C {
    t = 2;
  }
  const bt = T.bind(null),
    pt = new Proxy(T, {}),
    bd = D.bind(null),
    pd = new Proxy(D, {});
  for (const [f, t] of [
    [D, bt],
    [D, pt],
    [bd, T],
    [pd, T],
    [bd, bt],
    [pd, pt],
    [bd, pt],
  ]) {
    const o = Reflect.construct(f, [], t);
    o.t = 5;
    o.y = 6;
    console.log(
      JSON.stringify(o),
      Object.getPrototypeOf(o) === T.prototype,
      Object.getPrototypeOf(o) === Object.prototype,
    );
  }
}
{
  console.log("written bound target");
  function C() {
    this.x = 1;
  }
  class D extends C {}
  class T extends C {}
  const o = Reflect.construct(D.bind(null), [], T);
  o.y = 3;
  const p = Reflect.construct(D, [], new Proxy(T, {}));
  p.y = 4;
  console.log(JSON.stringify([o, p]), Object.isFrozen(Object.freeze(o)), Object.isFrozen(Object.freeze(p)));
}
{
  console.log("other ways to call reflect construct");
  function C() {
    this.x = 1;
  }
  class D extends C {}
  class T extends C {
    t = 1;
  }
  const rc = Reflect.construct;
  const a = rc(D, [], T),
    b = Reflect.construct.call(null, D, [], T),
    c = Reflect.apply(Reflect.construct, null, [D, [], T]),
    d = Reflect["construct"](D, [], T),
    e = Reflect.construct.apply(null, [D, [], T]),
    f = Reflect.construct.bind(null, D, [])(T);
  for (const v of [a, b, c, d, e, f]) {
    v.y = 3;
    v.t = 4;
    console.log(JSON.stringify(v), v instanceof T);
  }
  Object.freeze(a);
}
{
  console.log("three levels written");
  function C() {
    this.x = 1;
  }
  class D extends C {
    d = 1;
  }
  class E extends D {
    e = 2;
  }
  class T extends C {
    t = 3;
  }
  class U extends T {
    u = 4;
  }
  const a = Reflect.construct(E, [], T),
    b = Reflect.construct(E, [], U),
    c = Reflect.construct(U, [], E),
    d = Reflect.construct(D, [], U),
    e = Reflect.construct(D, [], E),
    f = Reflect.construct(E, [], D);
  for (const v of [a, b, c, d, e, f]) {
    v.t = "t";
    v.e = "e";
    v.z = "z";
  }
  console.log(JSON.stringify([a, b, c, d, e, f]));
  Object.freeze(a);
  Object.seal(c);
  console.log(Object.isFrozen(a), Object.isSealed(c));
}
{
  console.log("mixins");
  function C() {
    this.x = 1;
  }
  const Mix = Base =>
    class extends Base {
      m = 1;
    };
  class D extends C {
    d = 1;
  }
  class T extends Mix(C) {
    t = 2;
  }
  class V extends Mix(D) {
    v = 3;
  }
  for (const [f, t] of [
    [D, T],
    [T, D],
    [D, V],
    [V, D],
    [V, T],
    [T, V],
    [C, T],
    [C, V],
  ]) {
    const o = Reflect.construct(f, [], t);
    o.m = "m";
    o.t = "t";
    o.y = "y";
    console.log(f.name, t.name, JSON.stringify(o), o instanceof t);
  }
}
{
  console.log("mixins written");
  function C() {
    this.x = 1;
  }
  const Mix = Base =>
    class extends Base {
      m = 1;
    };
  class D extends C {
    d = 1;
  }
  class T extends Mix(C) {
    t = 2;
  }
  const o = Reflect.construct(D, [], T),
    p = Reflect.construct(T, [], D),
    q = Reflect.construct(C, [], T);
  o.m = 5;
  p.d = 6;
  q.t = 7;
  console.log(JSON.stringify([o, p, q]), Object.isFrozen(Object.freeze(o)));
}
{
  console.log("parent changed later");
  function C() {
    this.x = 1;
  }
  function C2() {
    this.x2 = 1;
  }
  class D extends C {
    d = 1;
  }
  class T extends C {
    t = 2;
  }
  const a = Reflect.construct(D, [], T);
  Object.setPrototypeOf(D, C2);
  const b = Reflect.construct(D, [], T),
    c = new D();
  Object.setPrototypeOf(T, C2);
  const d = Reflect.construct(D, [], T),
    e = new T();
  for (const v of [a, b, c, d, e]) {
    v.t = "t";
    v.y = "y";
    console.log(JSON.stringify(v), v instanceof T, v instanceof D, v instanceof C);
  }
}
{
  console.log("super in arrow and condition");
  function C() {
    this.x = 1;
  }
  class D extends C {
    constructor(k) {
      const go = () => super();
      if (k) go();
      else super();
      this.d = k;
    }
  }
  class T extends C {
    t = 2;
  }
  const a = Reflect.construct(D, [1], T),
    b = Reflect.construct(D, [0], T);
  a.t = 3;
  b.y = 4;
  console.log(JSON.stringify([a, b, new D(1), new T()]), Object.isFrozen(Object.freeze(a)));
}
{
  console.log("constructor returns another object");
  function C() {
    this.x = 1;
    return { other: 1 };
  }
  class D extends C {
    d = 1;
  }
  class T extends C {
    t = 2;
  }
  const a = Reflect.construct(D, [], T),
    b = new T(),
    c = Reflect.construct(C, [], T);
  a.t = 3;
  console.log(JSON.stringify([a, b, c]), a instanceof T, Object.getPrototypeOf(a) === Object.prototype);
}
{
  console.log("function with new target and arguments");
  function C(a, b) {
    this.a = a;
    this.b = b;
    this.nt = new.target.name;
    this.n = arguments.length;
  }
  class D extends C {
    constructor(...r) {
      super(...r, "d");
    }
  }
  class T extends C {
    t = 2;
  }
  const o = Reflect.construct(D, [1], T),
    p = Reflect.construct(D, [], T),
    q = Reflect.construct(C, [1, 2, 3], T);
  o.t = 1;
  console.log(JSON.stringify([o, p, q]));
}
{
  console.log("getters setters on prototypes of siblings");
  function C() {
    this.x = 1;
  }
  class D extends C {
    get v() {
      return "D" + this.x;
    }
    set x2(v) {
      this.x = v;
    }
  }
  class T extends C {
    get v() {
      return "T" + this.x;
    }
    set x(v) {
      Object.defineProperty(this, "x", { value: v * 2, writable: true, enumerable: true, configurable: true });
    }
  }
  const o = Reflect.construct(D, [], T),
    p = new D(),
    q = new T();
  console.log(o.v, p.v, q.v, JSON.stringify([o, p, q]));
}
{
  console.log("sloppy and called plainly");
  function C() {
    if (!new.target) return new C();
    this.x = 1;
  }
  class D extends C {}
  class T extends C {}
  const o = Reflect.construct(D, [], T),
    p = C(),
    q = Reflect.construct(C, [], D);
  o.y = 1;
  p.y = 2;
  q.y = 3;
  console.log(
    JSON.stringify([o, p, q]),
    [o, p, q].map(v => v.constructor.name),
  );
  Object.freeze(q);
}
{
  console.log("made object as prototype and in collections");
  function C() {
    this.x = 1;
  }
  class D extends C {}
  class T extends C {
    t = 1;
  }
  const o = Reflect.construct(D, [], T);
  const child = Object.create(o);
  child.t = 5;
  o.t = 6;
  const m = new Map([[o, 1]]),
    w = new WeakMap([[o, 2]]),
    s = new Set([o]);
  console.log(
    child.x,
    child.t,
    o.t,
    Object.keys(child),
    Object.keys(o),
    m.get(o),
    w.get(o),
    s.has(o),
    JSON.stringify(child),
  );
}
{
  console.log("symbols and indexes");
  class A {}
  class B extends A {
    x = 0;
    [Symbol.for("s")] = 1;
    0 = "zero";
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  console.log(Reflect.ownKeys(o), o[0], o[Symbol.for("s")]);
  o[0] = "a";
  o[Symbol.for("s")] = 2;
  o.x = 3;
  console.log(Reflect.ownKeys(o), Reflect.ownKeys(new C()));
}
{
  console.log("class fields that read each other on foreign");
  class A {
    a = 1;
  }
  class D extends A {
    d = this.a + 1;
    dd = this.t;
  }
  class T extends A {
    t = this.a + 10;
  }
  const o = Reflect.construct(D, [], T),
    p = Reflect.construct(T, [], D);
  console.log(JSON.stringify([o, p]), Object.keys(o), Object.keys(p), o.t, p.d);
}
{
  console.log("generators async arrow methods refused");
  class A {}
  class C extends A {
    x = 0;
  }
  for (const f of [() => {}, async function () {}, function* () {}, { m() {} }.m, Math.max, 1, null, undefined, {}]) {
    for (const [a, b] of [
      [f, C],
      [A, f],
    ]) {
      try {
        Reflect.construct(a, [], b);
        console.log("made");
      } catch (e) {
        console.log(e.constructor.name);
      }
    }
  }
}
{
  console.log("object and function as constructors");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  function F() {
    this.f = 1;
  }
  const a = Reflect.construct(Object, [], C),
    b = Reflect.construct(Function, ["return 1"], C),
    c = Reflect.construct(Object, [], F),
    d = Reflect.construct(C, [], Object),
    e = Reflect.construct(F, [], Object),
    f = Reflect.construct(Date, [0], C),
    g = Reflect.construct(RegExp, ["a"], C);
  a.x = 1;
  c.f = 2;
  d.x = 3;
  e.f = 4;
  console.log(
    JSON.stringify([a, c, d, e]),
    typeof b,
    b instanceof C,
    a instanceof C,
    Object.getPrototypeOf(d) === Object.prototype,
    f instanceof C,
    Object.prototype.toString.call(f),
    Object.prototype.toString.call(g),
  );
}
{
  console.log("array from of species");
  class A {}
  class B extends A {
    x = 0;
    length = 0;
  }
  class C extends B {}
  const a = Array.from.call(C, [1, 2]),
    b = Array.of.call(C, 7);
  console.log(JSON.stringify(a), JSON.stringify(b), a instanceof C, Object.keys(a));
  class L extends Array {
    static get [Symbol.species]() {
      return C;
    }
  }
  const m = new L(1, 2, 3).map(v => v * 2);
  console.log(JSON.stringify(m), m instanceof C, Object.keys(m));
}
{
  console.log("many classes one site");
  class A {}
  const made = [];
  for (let i = 0; i < 4; i++) {
    const K = class extends A {
      x = i;
    };
    const K2 = class extends K {
      y = i;
    };
    made.push(Reflect.construct(A, [], K2), Reflect.construct(K, [], K2), new K2());
  }
  for (const v of made) {
    v.y = "y";
  }
  console.log(JSON.stringify(made));
}
