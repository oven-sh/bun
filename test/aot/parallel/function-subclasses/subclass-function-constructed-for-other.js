// Classes below one function are constructed for each other.
{
  console.log("sibling classes below function");
  function C() {
    this.x = 1;
  }
  class D extends C {}
  class T extends C {}
  const o = Reflect.construct(D, [], T);
  o.y = 3;
  console.log(JSON.stringify(o), Object.keys(o), o instanceof T, o instanceof D, Object.isFrozen(Object.freeze(o)));
}
{
  console.log("sibling classes below function no freeze");
  function C() {
    this.x = 1;
  }
  class D extends C {}
  class T extends C {}
  const o = Reflect.construct(D, [], T);
  o.y = 3;
  console.log(JSON.stringify(o), Object.keys(o), o instanceof T, o instanceof D);
}
{
  console.log("sibling classes below function fields");
  function C() {
    this.x = 1;
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
  console.log(JSON.stringify(o), Object.keys(o), JSON.stringify(new T()), JSON.stringify(new D()));
}
{
  console.log("freeze other instances");
  function C() {
    this.x = 1;
  }
  class D extends C {}
  class T extends C {}
  const o = Reflect.construct(D, [], T);
  o.y = 3;
  Object.freeze(new T());
  Object.freeze(new D());
  console.log(JSON.stringify(o), Object.isFrozen(o));
}
{
  console.log("function below function below class");
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
  console.log("written pairs function root");
  function C() {
    this.x = 1;
  }
  class D extends C {
    d = 1;
  }
  class T extends C {
    t = 3;
  }
  const a = Reflect.construct(D, [], T),
    b = Reflect.construct(T, [], D),
    c = Reflect.construct(C, [], T),
    d = Reflect.construct(C, [], D),
    e = Reflect.construct(D, [], C),
    f = Reflect.construct(D, [], D);
  a.t = 5;
  b.d = 6;
  c.t = 7;
  d.d = 8;
  e.d = 9;
  f.d = 10;
  console.log(
    JSON.stringify([a, b, c, d, e, f]),
    [a, b, c, d, e, f].map(v => Object.keys(v).join()),
  );
}
{
  console.log("freeze seal all");
  function C() {
    this.x = 1;
  }
  class D extends C {
    d = 1;
  }
  class T extends C {
    t = 3;
  }
  const a = Reflect.construct(D, [], T),
    c = Reflect.construct(C, [], T);
  Object.seal(a);
  Object.preventExtensions(c);
  try {
    a.t = 1;
  } catch (e) {
    console.log(e.constructor.name);
  }
  try {
    c.t = 1;
  } catch (e) {
    console.log(e.constructor.name);
  }
  a.d = 2;
  c.x = 3;
  console.log(
    JSON.stringify([a, c]),
    a.t,
    c.t,
    Object.isSealed(a),
    Object.isFrozen(a),
    Object.isExtensible(c),
    Object.isFrozen(Object.freeze(new T())),
    Object.isFrozen(Object.freeze(new D())),
  );
}
{
  console.log("private static brand and sibling function root");
  function R0() {
    this.r = 1;
  }
  class D extends R0 {
    #p = 1;
    static has(o) {
      return #p in o;
    }
    static get(o) {
      return o.#p;
    }
  }
  class T extends R0 {
    #q = 2;
    static has(o) {
      return #q in o;
    }
    static get(o) {
      try {
        return o.#q;
      } catch (e) {
        return e.constructor.name;
      }
    }
  }
  const o = Reflect.construct(D, [], T);
  console.log(
    D.has(o),
    D.get(o),
    T.has(o),
    T.get(o),
    o instanceof T,
    JSON.stringify(o),
    T.has(new T()),
    D.has(new D()),
  );
}
{
  console.log("super property in foreign constructor");
  function R0() {
    this.r = 1;
  }
  R0.prototype.hi = function () {
    return "R0";
  };
  class D extends R0 {
    constructor() {
      super();
      this.said = super.hi() + this.hi();
    }
    hi() {
      return "D";
    }
  }
  class T extends R0 {
    hi() {
      return "T";
    }
  }
  const o = Reflect.construct(D, [], T);
  console.log(JSON.stringify(o), o.hi());
}
{
  console.log("construct inside constructor of function");
  function Base() {
    this.b = 1;
  }
  function Mid() {
    return Reflect.construct(Base, [], new.target);
  }
  class Top extends Mid {
    t = 2;
  }
  class Top2 extends Top {
    u = 3;
  }
  const o = new Top(),
    p = new Top2(),
    q = new Mid();
  o.t = 5;
  p.u = 6;
  q.b = 7;
  console.log(JSON.stringify([o, p, q]), o instanceof Top, p instanceof Top2, q instanceof Mid, q instanceof Base);
}
{
  console.log("helper of compiled classes");
  function _cs(t, o, e) {
    return Reflect.construct(Object.getPrototypeOf(o), e || [], Object.getPrototypeOf(t).constructor);
  }
  function P() {
    this.p = 1;
  }
  function Q() {
    return _cs(this, Q, arguments);
  }
  Object.setPrototypeOf(Q, P);
  Q.prototype = Object.create(P.prototype, { constructor: { value: Q, writable: true, configurable: true } });
  function R() {
    var t = _cs(this, R, arguments);
    t.r = 3;
    return t;
  }
  Object.setPrototypeOf(R, Q);
  R.prototype = Object.create(Q.prototype, { constructor: { value: R, writable: true, configurable: true } });
  const o = new R(),
    q = new Q();
  o.p = 2;
  console.log(JSON.stringify([o, q]), o instanceof R, o instanceof P, q instanceof R);
}
{
  console.log("function parent child");
  function P() {
    this.p = 1;
  }
  function Q() {
    this.q = 2;
  }
  Q.prototype = Object.create(P.prototype);
  const o = Reflect.construct(P, [], Q),
    r = Reflect.construct(Q, [], P);
  o.q = 5;
  r.p = 6;
  console.log(JSON.stringify(o), JSON.stringify(r), o instanceof Q, r instanceof Q, r instanceof P);
}
{
  console.log("class for function");
  class A {
    a = 1;
  }
  function F() {
    this.f = 1;
  }
  const o = Reflect.construct(A, [], F),
    p = Reflect.construct(F, [], A);
  o.f = 2;
  p.a = 3;
  console.log(
    JSON.stringify(o),
    JSON.stringify(p),
    o instanceof F,
    p instanceof A,
    JSON.stringify(new A()),
    JSON.stringify(new F()),
  );
}
{
  console.log("unrelated");
  class X {
    x = 1;
  }
  class Y {
    y = 2;
  }
  function F() {
    this.f = 3;
  }
  function G() {
    this.g = 4;
  }
  for (const [f, t] of [
    [X, Y],
    [Y, X],
    [X, F],
    [F, X],
    [F, G],
    [G, F],
  ]) {
    const o = Reflect.construct(f, [], t);
    o.x = "x";
    o.y = "y";
    o.f = "f";
    o.g = "g";
    console.log(JSON.stringify(o), o instanceof t, o instanceof f);
  }
  console.log(JSON.stringify([new X(), new Y(), new F(), new G()]));
}
