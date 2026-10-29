// Class expressions that functions of six forms return, with static blocks and private members of every kind. Here each function is called in the heritage of two classes.
function show(label, f) { let shown; try { shown = JSON.stringify(f()); } catch (error) { shown = error.constructor.name; } console.log(label + ": " + shown); }
{
  const make = (Base = Object) => class extends Base { static #c = 1; static { this.t = this.#c; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, private static field", () => C.t);
}
{
  const make = (Base = Object) => class extends Base { static #m() { return 5; } static { this.t = this.#m(); } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, private static method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, private static method", () => C.t);
}
{
  const make = (Base = Object) => class extends Base { static #v = 2; static get #a() { return this.#v; } static set #a(x) { this.#v = x; } static { this.#a = 9; this.t = this.#a; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, private static accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, private static accessor", () => C.t);
}
{
  const make = (Base = Object) => class extends Base { static #n = 1; static { this.#n = 40; } static take() { return this.#n++; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, a static method reads what the block stored, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, a static method reads what the block stored", () => [C.take(), C.take()]);
}
{
  const make = (Base = Object) => class extends Base { static #n = 3; static { this.get = () => this.#n; this.set = v => { this.#n = v; }; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, closures made in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, closures made in the block", () => [C.get(), C.set(8), C.get()]);
}
{
  const make = (Base = Object) => class extends Base { static #a = 1; static { this.#a += 10; } static b = this.#a; static { this.#a += 100; this.c = this.#a; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, two blocks around a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, two blocks around a field", () => [C.b, C.c]);
}
{
  const make = (Base = Object) => class extends Base { static { this.t = typeof super.toString; this.u = super.name; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, super in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, super in the block", () => [C.t, C.u]);
}
{
  const make = (Base = Object) => class extends Base { static #s; #i = 1; static { this.t = #s in this; this.u = #i in this; this.w = #i in new this(); } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, private names asked for in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, private names asked for in the block", () => [C.t, C.u, C.w]);
}
{
  const make = (Base = Object) => class extends Base { #x = 7; read() { return this.#x; } write(v) { this.#x = v; return this; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, private field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, private field", () => [new C().read(), new C().write(3).read()]);
}
{
  const make = (Base = Object) => class extends Base { #m() { return 11; } call() { return this.#m(); } static has(o) { return #m in o; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, private method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, private method", () => [new C().call(), C.has(new C()), C.has({})]);
}
{
  const make = (Base = Object) => class extends Base { #v = 1; get #a() { return this.#v; } set #a(x) { this.#v = x * 2; } run() { this.#a = 4; return this.#a; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, private accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, private accessor", () => new C().run());
}
{
  const make = (Base = Object) => class extends Base { #x = 6; static { this.peek = o => o.#x; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, the block reads a private field of an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, the block reads a private field of an instance", () => C.peek(new C()));
}
{
  const make = (Base = Object) => class extends Base { static a = 1; static b = this.a + 1; static { this.c = this.b + 1; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, static fields that read this, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, static fields that read this", () => [C.a, C.b, C.c]);
}
{
  const make = (Base = Object) => class extends Base { static #k = 4; static { function inner(c) { return c.#k; } this.t = inner(this); } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, a function declared in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, a function declared in the block", () => C.t);
}
{
  const make = (Base = Object) => class extends Base { static #k = 4; static { try { this.t = this.#k; throw 1; } catch (e) { this.u = e + this.#k; } finally { this.w = this.#k * 2; } } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, try, catch and finally in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, try, catch and finally in the block", () => [C.t, C.u, C.w]);
}
{
  const make = (Base = Object) => class extends Base { static #k = 0; static { for (let i = 0; i < 5; i++) this.#k += i; this.t = this.#k; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, a loop in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, a loop in the block", () => C.t);
}
{
  const make = (Base = Object) => class extends Base { static #s = 1; static get s() { return this.#s; } static set s(v) { this.#s = v; } static { this.s = 12; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, public accessors over a private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, public accessors over a private static field", () => C.s);
}
{
  const make = (Base = Object) => class K extends Base { static #c = 2; static { K.t = K.#c; } static again() { return K.#c; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, the name of the class in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, the name of the class in the block", () => [C.t, C.again()]);
}
{
  const make = (Base = Object) => class K extends Base { #p = 1; static first; static { K.first = new K(); K.seen = K.first.#p; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, the block constructs an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, the block constructs an instance", () => [C.seen, C.first instanceof C]);
}
{
  const make = (Base = Object) => class extends Base { #p = 5; get = () => this.#p; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, an arrow in a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, an arrow in a field", () => new C().get());
}
{
  const make = (Base = Object) => class extends Base { #p = [1, 2]; *each() { yield* this.#p; } };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow, a generator method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow, a generator method", () => [...new C().each()]);
}
{
  const make = (Base = Object) => { return class extends Base { static #c = 1; static { this.t = this.#c; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, private static field", () => C.t);
}
{
  const make = (Base = Object) => { return class extends Base { static #m() { return 5; } static { this.t = this.#m(); } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, private static method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, private static method", () => C.t);
}
{
  const make = (Base = Object) => { return class extends Base { static #v = 2; static get #a() { return this.#v; } static set #a(x) { this.#v = x; } static { this.#a = 9; this.t = this.#a; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, private static accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, private static accessor", () => C.t);
}
{
  const make = (Base = Object) => { return class extends Base { static #n = 1; static { this.#n = 40; } static take() { return this.#n++; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, a static method reads what the block stored, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, a static method reads what the block stored", () => [C.take(), C.take()]);
}
{
  const make = (Base = Object) => { return class extends Base { static #n = 3; static { this.get = () => this.#n; this.set = v => { this.#n = v; }; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, closures made in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, closures made in the block", () => [C.get(), C.set(8), C.get()]);
}
{
  const make = (Base = Object) => { return class extends Base { static #a = 1; static { this.#a += 10; } static b = this.#a; static { this.#a += 100; this.c = this.#a; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, two blocks around a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, two blocks around a field", () => [C.b, C.c]);
}
{
  const make = (Base = Object) => { return class extends Base { static { this.t = typeof super.toString; this.u = super.name; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, super in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, super in the block", () => [C.t, C.u]);
}
{
  const make = (Base = Object) => { return class extends Base { static #s; #i = 1; static { this.t = #s in this; this.u = #i in this; this.w = #i in new this(); } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, private names asked for in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, private names asked for in the block", () => [C.t, C.u, C.w]);
}
{
  const make = (Base = Object) => { return class extends Base { #x = 7; read() { return this.#x; } write(v) { this.#x = v; return this; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, private field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, private field", () => [new C().read(), new C().write(3).read()]);
}
{
  const make = (Base = Object) => { return class extends Base { #m() { return 11; } call() { return this.#m(); } static has(o) { return #m in o; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, private method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, private method", () => [new C().call(), C.has(new C()), C.has({})]);
}
{
  const make = (Base = Object) => { return class extends Base { #v = 1; get #a() { return this.#v; } set #a(x) { this.#v = x * 2; } run() { this.#a = 4; return this.#a; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, private accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, private accessor", () => new C().run());
}
{
  const make = (Base = Object) => { return class extends Base { #x = 6; static { this.peek = o => o.#x; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, the block reads a private field of an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, the block reads a private field of an instance", () => C.peek(new C()));
}
{
  const make = (Base = Object) => { return class extends Base { static a = 1; static b = this.a + 1; static { this.c = this.b + 1; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, static fields that read this, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, static fields that read this", () => [C.a, C.b, C.c]);
}
{
  const make = (Base = Object) => { return class extends Base { static #k = 4; static { function inner(c) { return c.#k; } this.t = inner(this); } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, a function declared in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, a function declared in the block", () => C.t);
}
{
  const make = (Base = Object) => { return class extends Base { static #k = 4; static { try { this.t = this.#k; throw 1; } catch (e) { this.u = e + this.#k; } finally { this.w = this.#k * 2; } } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, try, catch and finally in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, try, catch and finally in the block", () => [C.t, C.u, C.w]);
}
{
  const make = (Base = Object) => { return class extends Base { static #k = 0; static { for (let i = 0; i < 5; i++) this.#k += i; this.t = this.#k; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, a loop in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, a loop in the block", () => C.t);
}
{
  const make = (Base = Object) => { return class extends Base { static #s = 1; static get s() { return this.#s; } static set s(v) { this.#s = v; } static { this.s = 12; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, public accessors over a private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, public accessors over a private static field", () => C.s);
}
{
  const make = (Base = Object) => { return class K extends Base { static #c = 2; static { K.t = K.#c; } static again() { return K.#c; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, the name of the class in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, the name of the class in the block", () => [C.t, C.again()]);
}
{
  const make = (Base = Object) => { return class K extends Base { #p = 1; static first; static { K.first = new K(); K.seen = K.first.#p; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, the block constructs an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, the block constructs an instance", () => [C.seen, C.first instanceof C]);
}
{
  const make = (Base = Object) => { return class extends Base { #p = 5; get = () => this.#p; }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, an arrow in a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, an arrow in a field", () => new C().get());
}
{
  const make = (Base = Object) => { return class extends Base { #p = [1, 2]; *each() { yield* this.#p; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("arrow with a body, a generator method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("arrow with a body, a generator method", () => [...new C().each()]);
}
{
  function make(Base = Object) { return class extends Base { static #c = 1; static { this.t = this.#c; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, private static field", () => C.t);
}
{
  function make(Base = Object) { return class extends Base { static #m() { return 5; } static { this.t = this.#m(); } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, private static method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, private static method", () => C.t);
}
{
  function make(Base = Object) { return class extends Base { static #v = 2; static get #a() { return this.#v; } static set #a(x) { this.#v = x; } static { this.#a = 9; this.t = this.#a; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, private static accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, private static accessor", () => C.t);
}
{
  function make(Base = Object) { return class extends Base { static #n = 1; static { this.#n = 40; } static take() { return this.#n++; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, a static method reads what the block stored, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, a static method reads what the block stored", () => [C.take(), C.take()]);
}
{
  function make(Base = Object) { return class extends Base { static #n = 3; static { this.get = () => this.#n; this.set = v => { this.#n = v; }; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, closures made in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, closures made in the block", () => [C.get(), C.set(8), C.get()]);
}
{
  function make(Base = Object) { return class extends Base { static #a = 1; static { this.#a += 10; } static b = this.#a; static { this.#a += 100; this.c = this.#a; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, two blocks around a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, two blocks around a field", () => [C.b, C.c]);
}
{
  function make(Base = Object) { return class extends Base { static { this.t = typeof super.toString; this.u = super.name; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, super in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, super in the block", () => [C.t, C.u]);
}
{
  function make(Base = Object) { return class extends Base { static #s; #i = 1; static { this.t = #s in this; this.u = #i in this; this.w = #i in new this(); } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, private names asked for in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, private names asked for in the block", () => [C.t, C.u, C.w]);
}
{
  function make(Base = Object) { return class extends Base { #x = 7; read() { return this.#x; } write(v) { this.#x = v; return this; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, private field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, private field", () => [new C().read(), new C().write(3).read()]);
}
{
  function make(Base = Object) { return class extends Base { #m() { return 11; } call() { return this.#m(); } static has(o) { return #m in o; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, private method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, private method", () => [new C().call(), C.has(new C()), C.has({})]);
}
{
  function make(Base = Object) { return class extends Base { #v = 1; get #a() { return this.#v; } set #a(x) { this.#v = x * 2; } run() { this.#a = 4; return this.#a; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, private accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, private accessor", () => new C().run());
}
{
  function make(Base = Object) { return class extends Base { #x = 6; static { this.peek = o => o.#x; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, the block reads a private field of an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, the block reads a private field of an instance", () => C.peek(new C()));
}
{
  function make(Base = Object) { return class extends Base { static a = 1; static b = this.a + 1; static { this.c = this.b + 1; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, static fields that read this, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, static fields that read this", () => [C.a, C.b, C.c]);
}
{
  function make(Base = Object) { return class extends Base { static #k = 4; static { function inner(c) { return c.#k; } this.t = inner(this); } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, a function declared in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, a function declared in the block", () => C.t);
}
{
  function make(Base = Object) { return class extends Base { static #k = 4; static { try { this.t = this.#k; throw 1; } catch (e) { this.u = e + this.#k; } finally { this.w = this.#k * 2; } } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, try, catch and finally in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, try, catch and finally in the block", () => [C.t, C.u, C.w]);
}
{
  function make(Base = Object) { return class extends Base { static #k = 0; static { for (let i = 0; i < 5; i++) this.#k += i; this.t = this.#k; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, a loop in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, a loop in the block", () => C.t);
}
{
  function make(Base = Object) { return class extends Base { static #s = 1; static get s() { return this.#s; } static set s(v) { this.#s = v; } static { this.s = 12; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, public accessors over a private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, public accessors over a private static field", () => C.s);
}
{
  function make(Base = Object) { return class K extends Base { static #c = 2; static { K.t = K.#c; } static again() { return K.#c; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, the name of the class in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, the name of the class in the block", () => [C.t, C.again()]);
}
{
  function make(Base = Object) { return class K extends Base { #p = 1; static first; static { K.first = new K(); K.seen = K.first.#p; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, the block constructs an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, the block constructs an instance", () => [C.seen, C.first instanceof C]);
}
{
  function make(Base = Object) { return class extends Base { #p = 5; get = () => this.#p; }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, an arrow in a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, an arrow in a field", () => new C().get());
}
{
  function make(Base = Object) { return class extends Base { #p = [1, 2]; *each() { yield* this.#p; } }; }
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("declaration, a generator method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("declaration, a generator method", () => [...new C().each()]);
}
{
  const make = function (Base = Object) { return class extends Base { static #c = 1; static { this.t = this.#c; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, private static field", () => C.t);
}
{
  const make = function (Base = Object) { return class extends Base { static #m() { return 5; } static { this.t = this.#m(); } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, private static method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, private static method", () => C.t);
}
{
  const make = function (Base = Object) { return class extends Base { static #v = 2; static get #a() { return this.#v; } static set #a(x) { this.#v = x; } static { this.#a = 9; this.t = this.#a; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, private static accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, private static accessor", () => C.t);
}
{
  const make = function (Base = Object) { return class extends Base { static #n = 1; static { this.#n = 40; } static take() { return this.#n++; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, a static method reads what the block stored, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, a static method reads what the block stored", () => [C.take(), C.take()]);
}
{
  const make = function (Base = Object) { return class extends Base { static #n = 3; static { this.get = () => this.#n; this.set = v => { this.#n = v; }; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, closures made in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, closures made in the block", () => [C.get(), C.set(8), C.get()]);
}
{
  const make = function (Base = Object) { return class extends Base { static #a = 1; static { this.#a += 10; } static b = this.#a; static { this.#a += 100; this.c = this.#a; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, two blocks around a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, two blocks around a field", () => [C.b, C.c]);
}
{
  const make = function (Base = Object) { return class extends Base { static { this.t = typeof super.toString; this.u = super.name; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, super in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, super in the block", () => [C.t, C.u]);
}
{
  const make = function (Base = Object) { return class extends Base { static #s; #i = 1; static { this.t = #s in this; this.u = #i in this; this.w = #i in new this(); } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, private names asked for in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, private names asked for in the block", () => [C.t, C.u, C.w]);
}
{
  const make = function (Base = Object) { return class extends Base { #x = 7; read() { return this.#x; } write(v) { this.#x = v; return this; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, private field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, private field", () => [new C().read(), new C().write(3).read()]);
}
{
  const make = function (Base = Object) { return class extends Base { #m() { return 11; } call() { return this.#m(); } static has(o) { return #m in o; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, private method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, private method", () => [new C().call(), C.has(new C()), C.has({})]);
}
{
  const make = function (Base = Object) { return class extends Base { #v = 1; get #a() { return this.#v; } set #a(x) { this.#v = x * 2; } run() { this.#a = 4; return this.#a; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, private accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, private accessor", () => new C().run());
}
{
  const make = function (Base = Object) { return class extends Base { #x = 6; static { this.peek = o => o.#x; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, the block reads a private field of an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, the block reads a private field of an instance", () => C.peek(new C()));
}
{
  const make = function (Base = Object) { return class extends Base { static a = 1; static b = this.a + 1; static { this.c = this.b + 1; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, static fields that read this, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, static fields that read this", () => [C.a, C.b, C.c]);
}
{
  const make = function (Base = Object) { return class extends Base { static #k = 4; static { function inner(c) { return c.#k; } this.t = inner(this); } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, a function declared in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, a function declared in the block", () => C.t);
}
{
  const make = function (Base = Object) { return class extends Base { static #k = 4; static { try { this.t = this.#k; throw 1; } catch (e) { this.u = e + this.#k; } finally { this.w = this.#k * 2; } } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, try, catch and finally in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, try, catch and finally in the block", () => [C.t, C.u, C.w]);
}
{
  const make = function (Base = Object) { return class extends Base { static #k = 0; static { for (let i = 0; i < 5; i++) this.#k += i; this.t = this.#k; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, a loop in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, a loop in the block", () => C.t);
}
{
  const make = function (Base = Object) { return class extends Base { static #s = 1; static get s() { return this.#s; } static set s(v) { this.#s = v; } static { this.s = 12; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, public accessors over a private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, public accessors over a private static field", () => C.s);
}
{
  const make = function (Base = Object) { return class K extends Base { static #c = 2; static { K.t = K.#c; } static again() { return K.#c; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, the name of the class in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, the name of the class in the block", () => [C.t, C.again()]);
}
{
  const make = function (Base = Object) { return class K extends Base { #p = 1; static first; static { K.first = new K(); K.seen = K.first.#p; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, the block constructs an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, the block constructs an instance", () => [C.seen, C.first instanceof C]);
}
{
  const make = function (Base = Object) { return class extends Base { #p = 5; get = () => this.#p; }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, an arrow in a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, an arrow in a field", () => new C().get());
}
{
  const make = function (Base = Object) { return class extends Base { #p = [1, 2]; *each() { yield* this.#p; } }; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("function expression, a generator method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("function expression, a generator method", () => [...new C().each()]);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #c = 1; static { this.t = this.#c; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, private static field", () => C.t);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #m() { return 5; } static { this.t = this.#m(); } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, private static method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, private static method", () => C.t);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #v = 2; static get #a() { return this.#v; } static set #a(x) { this.#v = x; } static { this.#a = 9; this.t = this.#a; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, private static accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, private static accessor", () => C.t);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #n = 1; static { this.#n = 40; } static take() { return this.#n++; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, a static method reads what the block stored, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, a static method reads what the block stored", () => [C.take(), C.take()]);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #n = 3; static { this.get = () => this.#n; this.set = v => { this.#n = v; }; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, closures made in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, closures made in the block", () => [C.get(), C.set(8), C.get()]);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #a = 1; static { this.#a += 10; } static b = this.#a; static { this.#a += 100; this.c = this.#a; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, two blocks around a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, two blocks around a field", () => [C.b, C.c]);
}
{
  const make = (Base = Object) => { const K = class extends Base { static { this.t = typeof super.toString; this.u = super.name; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, super in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, super in the block", () => [C.t, C.u]);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #s; #i = 1; static { this.t = #s in this; this.u = #i in this; this.w = #i in new this(); } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, private names asked for in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, private names asked for in the block", () => [C.t, C.u, C.w]);
}
{
  const make = (Base = Object) => { const K = class extends Base { #x = 7; read() { return this.#x; } write(v) { this.#x = v; return this; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, private field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, private field", () => [new C().read(), new C().write(3).read()]);
}
{
  const make = (Base = Object) => { const K = class extends Base { #m() { return 11; } call() { return this.#m(); } static has(o) { return #m in o; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, private method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, private method", () => [new C().call(), C.has(new C()), C.has({})]);
}
{
  const make = (Base = Object) => { const K = class extends Base { #v = 1; get #a() { return this.#v; } set #a(x) { this.#v = x * 2; } run() { this.#a = 4; return this.#a; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, private accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, private accessor", () => new C().run());
}
{
  const make = (Base = Object) => { const K = class extends Base { #x = 6; static { this.peek = o => o.#x; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, the block reads a private field of an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, the block reads a private field of an instance", () => C.peek(new C()));
}
{
  const make = (Base = Object) => { const K = class extends Base { static a = 1; static b = this.a + 1; static { this.c = this.b + 1; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, static fields that read this, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, static fields that read this", () => [C.a, C.b, C.c]);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #k = 4; static { function inner(c) { return c.#k; } this.t = inner(this); } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, a function declared in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, a function declared in the block", () => C.t);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #k = 4; static { try { this.t = this.#k; throw 1; } catch (e) { this.u = e + this.#k; } finally { this.w = this.#k * 2; } } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, try, catch and finally in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, try, catch and finally in the block", () => [C.t, C.u, C.w]);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #k = 0; static { for (let i = 0; i < 5; i++) this.#k += i; this.t = this.#k; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, a loop in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, a loop in the block", () => C.t);
}
{
  const make = (Base = Object) => { const K = class extends Base { static #s = 1; static get s() { return this.#s; } static set s(v) { this.#s = v; } static { this.s = 12; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, public accessors over a private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, public accessors over a private static field", () => C.s);
}
{
  const make = (Base = Object) => { const K = class K extends Base { static #c = 2; static { K.t = K.#c; } static again() { return K.#c; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, the name of the class in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, the name of the class in the block", () => [C.t, C.again()]);
}
{
  const make = (Base = Object) => { const K = class K extends Base { #p = 1; static first; static { K.first = new K(); K.seen = K.first.#p; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, the block constructs an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, the block constructs an instance", () => [C.seen, C.first instanceof C]);
}
{
  const make = (Base = Object) => { const K = class extends Base { #p = 5; get = () => this.#p; }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, an arrow in a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, an arrow in a field", () => new C().get());
}
{
  const make = (Base = Object) => { const K = class extends Base { #p = [1, 2]; *each() { yield* this.#p; } }; return K; };
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("through a constant, a generator method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("through a constant, a generator method", () => [...new C().each()]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #c = 1; static { this.t = this.#c; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, private static field", () => C.t);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #m() { return 5; } static { this.t = this.#m(); } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, private static method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, private static method", () => C.t);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #v = 2; static get #a() { return this.#v; } static set #a(x) { this.#v = x; } static { this.#a = 9; this.t = this.#a; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, private static accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, private static accessor", () => C.t);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #n = 1; static { this.#n = 40; } static take() { return this.#n++; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, a static method reads what the block stored, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, a static method reads what the block stored", () => [C.take(), C.take()]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #n = 3; static { this.get = () => this.#n; this.set = v => { this.#n = v; }; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, closures made in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, closures made in the block", () => [C.get(), C.set(8), C.get()]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #a = 1; static { this.#a += 10; } static b = this.#a; static { this.#a += 100; this.c = this.#a; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, two blocks around a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, two blocks around a field", () => [C.b, C.c]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static { this.t = typeof super.toString; this.u = super.name; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, super in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, super in the block", () => [C.t, C.u]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #s; #i = 1; static { this.t = #s in this; this.u = #i in this; this.w = #i in new this(); } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, private names asked for in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, private names asked for in the block", () => [C.t, C.u, C.w]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { #x = 7; read() { return this.#x; } write(v) { this.#x = v; return this; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, private field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, private field", () => [new C().read(), new C().write(3).read()]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { #m() { return 11; } call() { return this.#m(); } static has(o) { return #m in o; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, private method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, private method", () => [new C().call(), C.has(new C()), C.has({})]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { #v = 1; get #a() { return this.#v; } set #a(x) { this.#v = x * 2; } run() { this.#a = 4; return this.#a; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, private accessor, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, private accessor", () => new C().run());
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { #x = 6; static { this.peek = o => o.#x; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, the block reads a private field of an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, the block reads a private field of an instance", () => C.peek(new C()));
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static a = 1; static b = this.a + 1; static { this.c = this.b + 1; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, static fields that read this, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, static fields that read this", () => [C.a, C.b, C.c]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #k = 4; static { function inner(c) { return c.#k; } this.t = inner(this); } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, a function declared in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, a function declared in the block", () => C.t);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #k = 4; static { try { this.t = this.#k; throw 1; } catch (e) { this.u = e + this.#k; } finally { this.w = this.#k * 2; } } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, try, catch and finally in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, try, catch and finally in the block", () => [C.t, C.u, C.w]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #k = 0; static { for (let i = 0; i < 5; i++) this.#k += i; this.t = this.#k; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, a loop in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, a loop in the block", () => C.t);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { static #s = 1; static get s() { return this.#s; } static set s(v) { this.#s = v; } static { this.s = 12; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, public accessors over a private static field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, public accessors over a private static field", () => C.s);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class K extends Base { static #c = 2; static { K.t = K.#c; } static again() { return K.#c; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, the name of the class in the block, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, the name of the class in the block", () => [C.t, C.again()]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class K extends Base { #p = 1; static first; static { K.first = new K(); K.seen = K.first.#p; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, the block constructs an instance, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, the block constructs an instance", () => [C.seen, C.first instanceof C]);
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { #p = 5; get = () => this.#p; }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, an arrow in a field, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, an arrow in a field", () => new C().get());
}
{
  const make = (() => { let hidden = 0; return (Base = Object) => { hidden++; return class extends Base { #p = [1, 2]; *each() { yield* this.#p; } }; }; })();
  class S0 extends make() {}
  class S extends make() {}
  const C = S;
  show("closure of another function, a generator method, two parents", () => Object.getPrototypeOf(S0) === Object.getPrototypeOf(S));
  show("closure of another function, a generator method", () => [...new C().each()]);
}
