// A lookup that ends at a property that is there, until the property goes away or was never there.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { console.log(parts.map(String).join(" | ")); }
function dynamic(text) { return (text + "!").slice(0, text.length); }

// 1: a field of a literal is deleted late: the read finds the prototype's
{
  const proto = { x: "proto" };
  const o = { __proto__: proto, x: 1 };
  function read(v) { return v.x; }
  show("1a", read(o) + 1);
  function remove(v) { delete v.x; }
  remove(chain(o));
  show("1b", read(o).length);
}
// 2: a field of a class instance
{
  class C { constructor() { this.x = 1; } }
  Object.defineProperty(C.prototype, "x", { get() { return "getter"; }, set(v) { Object.defineProperty(this, "x", { value: v, writable: true, configurable: true }); }, configurable: true });
  const o = new C();
  function read(v) { return v.x; }
  show("2a", read(o) + 1);
  function remove(v) { delete v.x; }
  remove(chain(o));
  show("2b", read(o).length);
}
// 3: a class field, with a method of the same name above
{
  class Base { x() { return "method"; } }
  class C extends Base { x = 1; }
  const o = new C();
  function read(v) { return v.x; }
  show("3a", read(o) + 1);
  delete chain(o).x;
  show("3b", read(o).call(o));
}
// 4: deleted under a key nobody can name
{
  const proto = { x: "proto" };
  const o = { __proto__: proto, x: 1, y: 2 };
  function read(v) { return v.x; }
  show("4a", read(o) + 1);
  delete chain(o)[dynamic("x")];
  show("4b", read(o).length, o.y + 1);
}
// 5: deleted by Reflect.deleteProperty
{
  const proto = { x: "proto" };
  const o = { __proto__: proto, x: 1 };
  function read(v) { return v.x; }
  show("5a", read(o) + 1);
  Reflect.deleteProperty(chain(o), "x");
  show("5b", read(o).length);
}
// 6: deleted through a receiver nobody tracks, escape before and after the read
{
  const proto = { x: "proto" };
  const o = { __proto__: proto, x: 1 };
  function read(v) { return v.x; }
  show("6a", read(o) + 1);
  globalThis.lostBox6 = o;
  delete globalThis.lostBox6.x;
  show("6b", read(o).length);
}
// 7: turned into an accessor
{
  const o = { x: 1 };
  function read(v) { return v.x; }
  show("7a", read(o) + 1);
  Object.defineProperty(chain(o), "x", { get() { return "getter"; } });
  show("7b", read(o).length);
}
// 8: a field that the constructor has not stored yet when a method reads it
{
  class Base { constructor() { this.early = this.peek(); } peek() { return this.x; } }
  class C extends Base { constructor() { super(); this.x = 1; } }
  Base.prototype.x = "inherited";
  const o = new C();
  show("8", o.early.length, o.x + 1, o.peek() + 1);
}
// 9: one literal of two has the field
{
  const proto = { x: "proto" };
  function make(withField) { return withField ? { __proto__: proto, x: 1 } : { __proto__: proto }; }
  function read(v) { return v.x; }
  show("9a", read(make(true)) + 1);
  show("9b", read(chain(make(false))).length);
}
// 10: `in` and hasOwnProperty after a late delete
{
  const o = { x: 1 };
  function has(v) { return "x" in v; }
  function hasOwn(v) { return Object.hasOwn(v, "x"); }
  show("10a", has(o), hasOwn(o));
  delete chain(o).x;
  show("10b", has(o), hasOwn(o), o.x);
}
// 11: frozen, sealed, not writable: decided late
{
  "use strict";
  const o = { x: 1 };
  function put(v, w) { try { v.x = w; return "stored"; } catch (e) { return e.constructor.name; } }
  show("11a", put(o, 2), o.x + 1);
  Object.freeze(chain(o));
  show("11b", put(o, "text"), o.x + 1);
  const p = { x: 1 };
  Object.defineProperty(chain(p), "x", { writable: false });
  show("11c", put(p, "text"), p.x + 1);
  const q = { x: 1 };
  Object.preventExtensions(chain(q));
  function add(v) { try { v.fresh = 1; return "stored"; } catch (e) { return e.constructor.name; } }
  show("11d", add(q), q.fresh, Object.keys(q).join());
  const proto = Object.freeze({ x: "frozen above" });
  const r = Object.create(proto);
  show("11e", put(r, 5), r.x.length, Object.keys(r).length);
}
