// The static block of a class expression shares the variables of the function that returns the class with the other members of the class, with the function, and with closures that leave it.
function show(label, f) { let shown; try { shown = JSON.stringify(f()); } catch (error) { shown = error.constructor.name; } console.log(label + ": " + shown); }
{
  const withId = Base => { let next = 1; return class extends Base { static { next = 100; } id = next++; }; };
  class S extends withId(Object) {}
  show("a field reads", () => [new S().id, new S().id]);
}
{
  const f = Base => { let n = 1; return class extends Base { static { n = 50; } get() { return n; } bump() { return ++n; } }; };
  class S extends f(Object) {}
  show("methods read and count up", () => [new S().get(), new S().bump(), new S().get()]);
}
{
  const f = () => { let n = 1; return class { static a = (n = 7); static { this.b = n; n = 9; } static c = n; }; };
  const C = f();
  show("static fields around the block", () => [C.a, C.b, C.c]);
}
{
  let out; const f = () => { let n = 1; return class { static { out = () => ++n; } peek() { return n; } }; };
  const C = f();
  show("a closure leaves the block", () => [out(), out(), new C().peek()]);
}
{
  const f = s => { let n = s; return class { static { n *= 2; } get() { return n++; } }; };
  const A = f(1), B = f(10);
  show("two calls have a variable each", () => [new A().get(), new B().get(), new A().get(), new B().get()]);
}
{
  const f = (Base, tag) => class extends Base { static { tag = tag + '!'; } tag() { return tag; } };
  class S extends f(Object, 'a') {}
  class T extends f(Object, 'b') {}
  show("a parameter", () => [new S().tag(), new T().tag()]);
}
{
  function outer() { let n = 0; const mk = () => class { static { n++; } }; class A extends mk() {} class B extends mk() {} return n; }
  show("a variable of the function around the factory", () => outer());
}
{
  const f = () => { const C = class { static { try { this.t = later; } catch (e) { this.t = e.constructor.name; } } }; const later = 1; return C; };
  class S extends f() {}
  show("a constant that is declared later", () => S.t);
}
{
  const f = () => { var v; const C = class { static { v = 3; } static get v() { return v; } }; return C; };
  class S extends f() {}
  show("a var", () => S.v);
}
{
  const f = () => { let n = 1; const C = class { static { n = 2; } }; C.n = n; return C; };
  class S extends f() {}
  show("the factory reads behind the class", () => S.n);
}
{
  const o = { tag: 'o', f() { const self = this; return class { static { this.t = self.tag; } }; } };
  const C = o.f();
  show("this of a method that returns the class", () => C.t);
}
{
  const make = () => { let n = 0; try { n = 1; } finally { var g = () => ++n; } return class { static { n += 10; } take() { return g(); } }; };
  class A extends make() {}
  show("a closure made in a finally block", () => [new A().take(), new A().take()]);
}
{
  const make = () => { let n = 1; return class { static { Object.defineProperty(this.prototype, 'n', { get() { return n; }, set(v) { n = v; } }); n = 3; } }; };
  class A extends make() {}
  show("accessors defined in the block", () => (() => { const a = new A(); const r = [a.n]; a.n = 8; r.push(new A().n); return r; })());
}
{
  const make = () => class { static #k = 1; static { this.Inner = class { static { this.t = 2; } }; this.t = this.#k; } };
  class A extends make() {}
  show("a class in the block", () => [A.t, A.Inner.t]);
}
{
  const tag = s => s; const make = () => class { static { this.t = tag`x`; } };
  const A = make(), B = make();
  show("a tagged template in the block", () => A.t === B.t);
}
{
  const make = () => { let n = 4; return class { static { this.t = eval('n'); n = 5; } static get n() { return n; } }; };
  class A extends make() {}
  show("evaluated text in the block", () => [A.t, A.n]);
}
{
  const make = () => { let n = 1; return class { static { this.g = function* () { yield n++; yield n++; }; n = 20; } }; };
  class A extends make() {}
  show("a generator made in the block", () => [...A.g()]);
}
{
  const outer = x => { let n = x; const inner = () => class { static { n += 1; } get() { return n; } }; return inner; };
  const mk = outer(5);
  class A extends mk() {}
  class B extends mk() {}
  show("a factory that a factory returns", () => [new A().get(), new B().get()]);
}
{
  const make = f => { let n = 1; if (f) return class { static { n = 2; } get() { return n; } }; return class { static { n = 3; } get() { return n; } }; };
  class A extends make(true) {}
  class B extends make(false) {}
  show("two classes, one returned", () => [new A().get(), new B().get()]);
}
{
  const o = { make() { let n = 1; return class { static { n = 9; } get() { return n; } }; } };
  class A extends o.make() {}
  show("a method is the factory", () => new A().get());
}
{
  class F { static make() { let n = 1; return class { static #p = 2; static { n = this.#p; } get() { return n; } }; } }
  class A extends F.make() {}
  show("a static method is the factory", () => new A().get());
}
{
  const make = i => { let n = i; return class { static { n *= 2; } get() { return n; } }; };
  const all = []; for (let i = 1; i < 4; i++) all.push(make(i));
  show("called in a loop", () => all.map(C => new C().get()));
}
{
  const make = i => { let n = i; return class { static #s = i; static { n += this.#s; } get() { return n; } }; };
  const A = make(1), B = make(2), C = make(3), D = make(4), E = make(5);
  show("called five times", () => [A, B, C, D, E].map(K => new K().get()));
}
{
  const make = () => { let n = 1; return class { static { n = 6; } get() { return n; } }; };
  const box = { K: make() };
  show("stored in an object", () => new box.K().get());
}
{
  const A = B => { let a = 1; return class extends B { static { a = 10; } a() { return a; } }; };
  const Z = B => { let z = 2; return class extends B { static #q = 5; static { z = this.#q; } z() { return z; } }; };
  class S extends A(Z(Object)) {}
  show("a chain of mixins", () => [new S().a(), new S().z()]);
}
{
  class P { static base() { return 'p'; } }
  const make = B => class extends B { static { this.t = super.base(); } static base() { return 'own'; } };
  class S extends make(P) {}
  show("super in the block calls the parent", () => [S.t, S.base()]);
}
{
  class P { v() { return 1; } }
  const make = B => { let n = 0; return class extends B { static { n = 5; } f = super.v() + n; }; };
  class S extends make(P) {}
  show("super in a field", () => new S().f);
}
{
  const make = () => { let seen; return class { static { seen = 'block'; } constructor() { this.t = seen + (new.target === undefined); } }; };
  class S extends make() {}
  show("the constructor reads", () => new S().t);
}
{
  const make = () => class K { static #n = 1; static { K.self = K; } static same() { return K.self === K && K.#n; } };
  const A = make(), B = make();
  show("the name of the class", () => [A.same(), B.same(), A.self === B.self]);
}
{
  const make = () => class { #x = 1; static has(o) { return #x in o; } };
  const A = make(), B = make();
  show("private fields of two evaluations", () => [A.has(new A()), A.has(new B()), B.has(new A()), B.has(new B())]);
}
{
  const make = v => class { static #x = v; static read(k) { return k.#x; } };
  const A = make(1), B = make(2);
  show('the other class is refused', () => A.read(B));
  show("private static fields of two evaluations", () => [A.read(A), B.read(B)]);
}
{
  const make = v => class { #m() { return v; } static call(o) { return o.#m(); } };
  const A = make(1), B = make(2);
  show('an instance of the other class is refused', () => A.call(new B()));
  show("private methods of two evaluations", () => [A.call(new A()), B.call(new B())]);
}
{
  const make = () => { let n = 1; return class { static #s = 3; static { n = this.#s; } get() { return n; } }; };
  class A extends make() {}
  const again = [make].map(f => f())[0];
  show("the factory is also called through a list", () => [new A().get(), new again().get()]);
}
{
  const k = Symbol('k'); const make = () => { let n = 1; return class { static [k] = 2; static { n = this[k]; } get() { return n; } }; };
  class A extends make() {}
  show("a static field under a symbol", () => new A().get());
}
{
  let c = 0; const make = () => { let n = 1; return class { static { n = 7; } ['m' + ++c]() { return n; } }; };
  class A extends make() {}
  show("a method under a computed key", () => new A().m1());
}
{
  const make = () => { let n = 1; return class { #p = n; static { n = 2; } get p() { return this.#p; } }; };
  class A extends make() {}
  show("a private field is filled from the variable", () => new A().p);
}
{
  let t = true; const make = () => { let n = 1; return class { static { n = 2; if (t) throw new RangeError('x'); } get() { return n; } }; };
  show('the first call throws', () => { class A extends make() {} return 1; });
  t = false;
  class B extends make() {}
  show("a block that throws once", () => new B().get());
}
