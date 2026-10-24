// Static methods that use instance private names on `this`, and instance methods that use static ones, which type-checks but throws at run time.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
class InstanceFromStatic { #f() { return 42; } #v = 7; get #g() { return 8; } static m() { return this.#f(); } static v() { return this.#v; } static g() { return this.#g; } static put(x) { this.#v = x; return this.#v; } static has() { return #f in this; } }
row("an instance method from a static method, on an instance", () => InstanceFromStatic.m.call(new InstanceFromStatic()));
row("an instance method from a static method, on the class", () => InstanceFromStatic.m());
row("an instance field from a static method", () => [said(() => InstanceFromStatic.v.call(new InstanceFromStatic())), said(() => InstanceFromStatic.v())].join());
row("an instance getter from a static method", () => [said(() => InstanceFromStatic.g.call(new InstanceFromStatic())), said(() => InstanceFromStatic.g())].join());
row("a store from a static method", () => [said(() => InstanceFromStatic.put.call(new InstanceFromStatic(), 3)), said(() => InstanceFromStatic.put(3))].join());
row("in, from a static method", () => [InstanceFromStatic.has(), InstanceFromStatic.has.call(new InstanceFromStatic())].join());
class StaticFromInstance { static #f() { return 42; } static #v = 7; static get #g() { return 8; } m() { return this.#f(); } v() { return this.#v; } g() { return this.#g; } put(x) { this.#v = x; return this.#v; } }
const sfi = new StaticFromInstance();
row("a static method from an instance method, on the class", () => sfi.m.call(StaticFromInstance));
row("a static method from an instance method, on an instance", () => sfi.m());
row("a static field from an instance method", () => [said(() => sfi.v.call(StaticFromInstance)), said(() => sfi.v())].join());
row("a static getter from an instance method", () => [said(() => sfi.g.call(StaticFromInstance)), said(() => sfi.g())].join());
row("a store from an instance method", () => [said(() => sfi.put.call(StaticFromInstance, 3)), said(() => sfi.put(3))].join());
class A { static #m() { return "A"; } #i = "a"; static own() { return A.#m(); } static ofB() { return said(() => B.#m()) + " " + said(() => new B().#i); } }
class B { static #m() { return "B"; } #i = "b"; static own() { return B.#m(); } static ofA() { return said(() => A.#m()) + " " + said(() => new A().#i); } }
row("another class's member of the same name", () => [A.own(), B.own(), A.ofB(), B.ofA()].join(" | "));
class Outer {
  static #x = "outer"; #y = "outer y";
  static Inner = class Inner {
    static #x = "inner"; #y = "inner y";
    static own() { return Inner.#x + " " + new Inner().#y; }
    static ofOuter() { return said(() => Outer.#x) + " " + said(() => new Outer().#y); }
  };
  static own() { return Outer.#x + " " + new Outer().#y; }
  static ofInner() { return said(() => Outer.Inner.#x) + " " + said(() => new Outer.Inner().#y); }
}
row("a name that an inner class declares again", () => [Outer.own(), Outer.Inner.own(), Outer.Inner.ofOuter(), Outer.ofInner()].join(" | "));
function make(n) { return class K { #f() { return n; } static #s() { return -n; } static viaStatic(o) { return o.#f(); } viaInstance(o) { return o.#s(); } }; }
const K1 = make(1), K2 = make(2);
row("made twice", () => [said(() => K1.viaStatic(new K1())), said(() => K1.viaStatic(new K2())), said(() => K1.viaStatic(K1)), said(() => new K1().viaInstance(K1)), said(() => new K1().viaInstance(K2)), said(() => new K1().viaInstance(new K1()))].join());
row("on what is no object", () => [said(() => InstanceFromStatic.m.call(1)), said(() => InstanceFromStatic.m.call(null)), said(() => sfi.m.call("s")), said(() => sfi.m.call(undefined))].join());
