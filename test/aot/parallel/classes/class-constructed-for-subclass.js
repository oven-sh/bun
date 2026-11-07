// A class is constructed for a class below beside or above it.
{
  console.log("own field skipped");
  class A {}
  class C extends A {
    x = 0;
  }
  const o = Reflect.construct(A, [], C);
  o.x = 1;
  console.log(JSON.stringify(o), Object.keys(o), o.x, "x" in o);
}
{
  console.log("inherited field skipped read");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  console.log(o.x, "x" in o, Object.keys(o), JSON.stringify(o), o instanceof B, o instanceof C);
}
{
  console.log("inherited field skipped store");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  o.x = 1;
  console.log(JSON.stringify(o), Object.keys(o), { ...o }, Object.entries(o));
  for (const k in o) console.log(k);
}
{
  console.log("inherited beside real");
  class A {}
  class B extends A {
    x = 0;
    y = "s";
  }
  class C extends B {
    z = 2;
  }
  const o = Reflect.construct(A, [], C);
  const r = new C();
  const b = new B();
  o.y = "t";
  console.log(JSON.stringify(o), JSON.stringify(r), JSON.stringify(b), o.x, o.z, r.x, r.z);
}
{
  console.log("middle constructor");
  class A {
    a = 1;
  }
  class B extends A {
    x = 0;
  }
  class C extends B {
    c = 3;
  }
  const o = Reflect.construct(B, [], C);
  o.c = 4;
  o.q = 5;
  console.log(JSON.stringify(o), Object.keys(o));
}
{
  console.log("sibling classes below class");
  class C {
    x = 1;
  }
  class D extends C {
    d = 1;
  }
  class T extends C {
    t = 2;
  }
  const o = Reflect.construct(D, [], T);
  o.y = 3;
  o.t = 9;
  console.log(
    JSON.stringify(o),
    Object.keys(o),
    JSON.stringify(new T()),
    JSON.stringify(new D()),
    Object.isFrozen(Object.freeze(o)),
  );
}
{
  console.log("child for parent");
  class A {
    a = 1;
  }
  class B extends A {
    b = 2;
  }
  const o = Reflect.construct(B, [], A);
  o.b = 3;
  o.c = 4;
  console.log(
    JSON.stringify(o),
    o instanceof B,
    o instanceof A,
    Object.getPrototypeOf(o) === A.prototype,
    JSON.stringify(new A()),
    JSON.stringify(new B()),
  );
}
{
  console.log("private name skipped");
  class A {}
  class B extends A {
    #p = 1;
    static has(o) {
      return #p in o;
    }
    static get(o) {
      try {
        return o.#p;
      } catch (e) {
        return e.constructor.name;
      }
    }
    static set(o) {
      try {
        o.#p = 2;
        return "set";
      } catch (e) {
        return e.constructor.name;
      }
    }
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  console.log(B.has(o), B.get(o), B.set(o), B.has(new C()), B.get(new C()), B.set(new C()));
}
{
  console.log("private method skipped");
  class A {}
  class B extends A {
    #m() {
      return 1;
    }
    static has(o) {
      return #m in o;
    }
    static call(o) {
      try {
        return o.#m();
      } catch (e) {
        return e.constructor.name;
      }
    }
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  console.log(B.has(o), B.call(o), B.has(new C()), B.call(new C()));
}
{
  console.log("private on sibling");
  class A {}
  class D extends A {
    #p = 1;
    static has(o) {
      return #p in o;
    }
  }
  class T extends A {
    #q = 2;
    static has(o) {
      return #q in o;
    }
  }
  const o = Reflect.construct(D, [], T);
  console.log(D.has(o), T.has(o), D.has(new D()), T.has(new T()), D.has(new T()), T.has(new D()));
}
{
  console.log("delete define");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  console.log(delete o.x, Object.getOwnPropertyDescriptor(o, "x"));
  Object.defineProperty(o, "x", { value: 5, enumerable: false, configurable: true, writable: false });
  console.log(Object.keys(o), o.x, JSON.stringify(Object.getOwnPropertyDescriptor(o, "x")));
  try {
    o.x = 6;
  } catch (e) {
    console.log(e.constructor.name);
  }
  console.log(o.x);
}
{
  console.log("seal prevent");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  Object.preventExtensions(o);
  try {
    o.x = 1;
  } catch (e) {
    console.log(e.constructor.name);
  }
  console.log(o.x, Object.keys(o), Object.isSealed(o), Object.isFrozen(o));
  const p = Reflect.construct(A, [], C);
  Object.seal(p);
  try {
    p.x = 1;
  } catch (e) {
    console.log(e.constructor.name);
  }
  console.log(p.x, Object.keys(p));
}
{
  console.log("accessor above");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {
    get y() {
      return this.x;
    }
    set y(v) {
      this.x = v;
    }
  }
  const o = Reflect.construct(A, [], C);
  console.log(o.y);
  o.y = 7;
  console.log(o.y, JSON.stringify(o));
}
{
  console.log("setter on prototype hit when field absent");
  class A {
    set x(v) {
      console.log("setter", v);
    }
    get x() {
      return "got";
    }
  }
  class B extends A {
    x = 0;
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  o.x = 1;
  console.log(o.x, Object.keys(o), new C().x, Object.keys(new C()));
}
{
  console.log("assign clone");
  class A {}
  class B extends A {
    x = 0;
    y = 1;
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  o.y = 2;
  console.log(
    Object.assign({}, o),
    structuredClone(o),
    Object.getOwnPropertyNames(o),
    Reflect.ownKeys(o),
    Object.values(o),
    Object.hasOwn(o, "x"),
    o.hasOwnProperty("y"),
  );
}
{
  console.log("new target chain");
  class A {
    constructor() {
      this.nt = new.target.name;
    }
  }
  class B extends A {
    x = 0;
    constructor() {
      super();
      this.b = new.target.name;
    }
  }
  class C extends B {}
  const o = Reflect.construct(B, [], C),
    p = Reflect.construct(A, [], C),
    q = Reflect.construct(C, [], A),
    r = Reflect.construct(C, [], B);
  for (const v of [o, p, q, r]) console.log(JSON.stringify(v), Object.getPrototypeOf(v).constructor.name);
}
{
  console.log("inside constructor");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {
    constructor() {
      return Reflect.construct(A, [], new.target);
    }
  }
  class E extends C {
    e = 1;
  }
  const o = new C(),
    p = new E();
  o.x = 1;
  p.x = 2;
  p.e = 3;
  console.log(JSON.stringify(o), JSON.stringify(p), o instanceof C, p instanceof E);
}
{
  console.log("loop mixed");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  let s = "";
  for (let i = 0; i < 2000; i++) {
    const o = i % 3 ? new C() : Reflect.construct(A, [], C);
    if (i % 2) o.x = i;
    if (i > 1994) s += JSON.stringify(o) + ("x" in o) + ";";
  }
  console.log(s);
}
{
  console.log("builtins above");
  class M extends Map {
    m = 1;
  }
  class N extends Map {
    n = 2;
  }
  class E1 extends Error {
    e = 1;
  }
  class L extends Array {
    l = 1;
  }
  class L2 extends L {
    k = 2;
  }
  const a = Reflect.construct(M, [], N);
  a.n = 3;
  const b = Reflect.construct(Map, [], N);
  b.n = 4;
  b.set(1, 2);
  const c = Reflect.construct(Error, ["m"], E1);
  c.e = 5;
  const d = Reflect.construct(Array, [3], L2);
  d.l = 6;
  d.k = 7;
  const e = Reflect.construct(L, [], L2);
  e.k = 8;
  console.log(
    Object.keys(a),
    a instanceof N,
    a.size,
    Object.keys(b),
    b.size,
    Object.keys(c),
    c.message,
    Object.keys(d),
    d.length,
    Object.keys(e),
    e.length,
  );
}
{
  console.log("bound and proxy");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  const bc = C.bind(null),
    pc = new Proxy(C, {}),
    ba = A.bind(null),
    pa = new Proxy(A, {});
  for (const [f, t] of [
    [A, bc],
    [A, pc],
    [ba, C],
    [pa, C],
    [ba, bc],
    [pa, pc],
  ]) {
    const o = Reflect.construct(f, [], t);
    o.x = 1;
    console.log(
      JSON.stringify(o),
      Object.getPrototypeOf(o) === C.prototype,
      Object.getPrototypeOf(o) === Object.prototype,
    );
  }
}
{
  console.log("super method calls");
  class A {
    who() {
      return "A";
    }
  }
  class B extends A {
    x = 0;
    who() {
      return "B" + super.who() + this.x;
    }
  }
  class C extends B {
    who() {
      return "C" + super.who();
    }
  }
  const o = Reflect.construct(A, [], C);
  console.log(o.who());
  o.x = 1;
  console.log(o.who(), JSON.stringify(o));
}
{
  console.log("typed number field");
  class A {}
  class B extends A {
    x = 1.5;
    n = 2;
    s = "a";
  }
  class C extends B {}
  function sum(o) {
    return o.x + o.n + o.s;
  }
  console.log(sum(new C()), sum(Reflect.construct(A, [], C)), sum(new B()));
}
{
  console.log("through function");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  function make(F, T) {
    return Reflect.construct(F, [], T);
  }
  for (const [f, t] of [
    [A, C],
    [B, C],
    [C, C],
    [C, A],
    [A, B],
    [A, A],
  ]) {
    const o = make(f, t);
    o.x = 1;
    console.log(f.name, t.name, JSON.stringify(o), Object.keys(o).length);
  }
}
{
  console.log("class tree");
  class C {
    x = 1;
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
  for (const [f, t] of [
    [D, T],
    [D, U],
    [E, T],
    [E, U],
    [T, D],
    [U, E],
    [C, T],
    [C, U],
    [C, E],
    [D, E],
    [E, D],
    [T, U],
    [U, T],
    [D, C],
    [U, C],
  ]) {
    const o = Reflect.construct(f, [], t);
    o.t = "t";
    o.e = "e";
    o.z = "z";
    console.log(f.name, t.name, JSON.stringify(o), Object.getPrototypeOf(o) === t.prototype);
  }
  console.log(JSON.stringify([new D(), new E(), new T(), new U(), new C()]));
}
{
  console.log("reads of fields never made");
  class A {}
  class B extends A {
    n = 1;
    f = 1.5;
    s = "s";
    o = {};
    a = [];
    b = true;
    u = undefined;
    g = () => 1;
  }
  class C extends B {
    read() {
      return [this.n, this.f, this.s, this.o, this.a, this.b, this.u, this.g];
    }
  }
  console.log(Reflect.construct(A, [], C).read(), new C().read().length);
  const o = Reflect.construct(A, [], C);
  Object.freeze(o);
  console.log(o.read(), Object.keys(o));
}
{
  console.log("methods as fields and this capture");
  class A {}
  class B extends A {
    x = 1;
    get = () => this.x;
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  console.log(typeof o.get, o.x);
  o.get = function () {
    return 5;
  };
  console.log(o.get(), Object.keys(o), new C().get());
}
{
  console.log("accessor keyword and static");
  class A {}
  class B extends A {
    static s = 1;
    accessor v = 2;
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  let r;
  try {
    r = o.v;
  } catch (e) {
    r = e.constructor.name;
  }
  let w;
  try {
    o.v = 1;
    w = "stored";
  } catch (e) {
    w = e.constructor.name;
  }
  console.log(r, w, C.s, new C().v, Object.keys(o));
}
{
  console.log("new target handed on three levels");
  class A {
    constructor() {
      this.a = new.target === C;
    }
  }
  class B extends A {
    x = 0;
    constructor() {
      super();
      this.b = new.target === C;
    }
  }
  class C extends B {
    y = 1;
    constructor() {
      super();
      this.c = new.target === C;
    }
  }
  class Z {
    z = 9;
  }
  for (const [f, t] of [
    [A, C],
    [B, C],
    [C, C],
    [C, Z],
    [B, Z],
    [A, Z],
    [Z, C],
    [Z, B],
    [Z, A],
  ]) {
    const o = Reflect.construct(f, [], t);
    o.x = "x";
    o.y = "y";
    o.z = "z";
    console.log(f.name, t.name, JSON.stringify(o), o instanceof t);
  }
}
{
  console.log("for in spread entries with prototype fields");
  class A {}
  class B extends A {
    x = 0;
    y = 1;
  }
  class C extends B {
    z = 2;
  }
  C.prototype.inherited = 1;
  const o = Reflect.construct(A, [], C);
  o.z = 1;
  o.x = 2;
  o.w = 3;
  const ks = [];
  for (const k in o) ks.push(k);
  console.log(ks, { ...o }, Object.entries(o), JSON.stringify(o), Object.assign({ y: 0 }, o), structuredClone(o));
}
{
  console.log("order of keys differs from declaration");
  class A {}
  class B extends A {
    x = 0;
    y = 1;
  }
  class C extends B {
    z = 2;
  }
  const o = Reflect.construct(A, [], C);
  o.z = 1;
  o.y = 2;
  o.x = 3;
  console.log(Object.keys(o), JSON.stringify(o), Object.keys(new C()));
  delete o.y;
  o.y = 4;
  console.log(Object.keys(o));
}
{
  console.log("getter setter defined on made");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  const o = Reflect.construct(A, [], C);
  let log = [];
  Object.defineProperty(o, "x", {
    get() {
      log.push("get");
      return 1;
    },
    set(v) {
      log.push("set" + v);
    },
    enumerable: true,
    configurable: true,
  });
  o.x = 5;
  console.log(o.x, log, JSON.stringify(o), Object.keys(o));
  function rd(v) {
    return v.x;
  }
  console.log(rd(o), rd(new C()), rd(new B()), log);
}
{
  console.log("instanceof and has instance");
  class A {}
  class B extends A {
    x = 0;
  }
  class C extends B {}
  class Z {}
  const o = Reflect.construct(A, [], C),
    p = Reflect.construct(C, [], Z),
    q = Reflect.construct(Z, [], C);
  console.log(
    [o, p, q].map(v =>
      [
        v instanceof A,
        v instanceof B,
        v instanceof C,
        v instanceof Z,
        A.prototype.isPrototypeOf(v),
        v.constructor.name,
      ].join(),
    ),
  );
}
{
  console.log("proxies with traps");
  class A {
    a = 1;
  }
  class B extends A {
    x = 0;
  }
  class C extends B {}
  const seen = [];
  const pc = new Proxy(C, {
    get(t, k, r) {
      seen.push(String(k));
      return Reflect.get(t, k, r);
    },
  });
  const o = Reflect.construct(A, [], pc),
    p = Reflect.construct(B, [], pc),
    q = new pc();
  o.x = 1;
  p.x = 2;
  q.x = 3;
  console.log(
    JSON.stringify([o, p, q]),
    seen,
    [o, p, q].map(v => v instanceof C),
  );
}
{
  console.log("promise error map heirs");
  class P1 extends Promise {
    p = 1;
  }
  class P2 extends P1 {
    q = 2;
  }
  class E1 extends Error {
    e = 1;
  }
  class E2 extends E1 {
    f = 2;
  }
  class M1 extends Map {
    m = 1;
  }
  class M2 extends M1 {
    n = 2;
  }
  const a = Reflect.construct(Promise, [() => {}], P2),
    b = Reflect.construct(P1, [() => {}], P2),
    c = Reflect.construct(Error, ["x"], E2),
    d = Reflect.construct(E1, ["y"], E2),
    e = Reflect.construct(Map, [], M2),
    f = Reflect.construct(M1, [], M2),
    g = Reflect.construct(M2, [], E2),
    h = Reflect.construct(E2, ["z"], M2);
  for (const v of [a, b, c, d, e, f, g, h]) {
    v.q = "q";
    v.f = "f";
    v.n = "n";
    console.log(Object.keys(v), Object.getPrototypeOf(v).constructor.name, Object.prototype.toString.call(v));
  }
  console.log(e.size, f.size, g.size, c.message, d.message, h.message);
  try {
    h.size;
  } catch (x) {
    console.log(x.constructor.name);
  }
}
{
  console.log("typescript like parameter properties");
  class A {
    constructor(v) {
      this.v = v;
    }
  }
  class B extends A {
    x;
    y = this.v + 1;
  }
  class C extends B {
    z = this.y + 1;
  }
  const o = Reflect.construct(A, [1], C),
    p = Reflect.construct(B, [1], C),
    q = Reflect.construct(C, [1], A);
  console.log(
    JSON.stringify([o, p, q, new C(1)]),
    [o, p, q].map(v => Object.keys(v).join()),
  );
}
{
  console.log("many made then real in hot function");
  class A {}
  class B extends A {
    x = 0;
    y = 0;
  }
  class C extends B {
    sum() {
      return this.x + this.y;
    }
  }
  function bump(o, i) {
    o.x = i;
    return o.sum();
  }
  let t = 0,
    n = 0;
  for (let i = 0; i < 5000; i++) {
    const o = i & 1 ? new C() : Reflect.construct(A, [], C);
    const r = bump(o, i);
    if (r === r) t += r;
    else n++;
    if (i > 4997) console.log(JSON.stringify(o));
  }
  console.log(t, n);
}
