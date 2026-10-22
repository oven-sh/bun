// Descriptors and maps of descriptors that arrive late or change their kind.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { console.log(parts.map(String).join(" | ")); }
function dynamic(text) { return (text + "!").slice(0, text.length); }

// 1: the receiver is known long before the descriptor
{
  function define(o, d) { Object.defineProperty(o, "p", d); }
  const o = {};
  define(o, chain(chain(chain({ value: "text", configurable: true }))));
  show("1", o.p.length);
}
// 2: a data descriptor first, an accessor descriptor late
{
  function define(o, d) { Object.defineProperty(o, "p", d); }
  const a = {}, b = {};
  define(a, { value: 1, configurable: true });
  show("2a", a.p + 1);
  define(b, chain({ get() { return helper(); }, configurable: true }));
  function helper() { return "getter"; }
  show("2b", b.p.length);
  define(a, chain({ get() { return [1]; } }));
  show("2c", a.p.length);
}
// 3: an accessor descriptor first, a data descriptor late
{
  function define(o, d) { Object.defineProperty(o, "p", d); }
  const a = {};
  define(a, { get() { return "getter"; }, configurable: true });
  show("3a", a.p.length);
  define(a, chain({ value: 7 }));
  show("3b", a.p + 1);
}
// 4: the fields of the descriptor are filled late
{
  const d = {};
  function fill(x) { x.get = function () { return this.base + 1; }; x.configurable = true; }
  fill(chain(d));
  const o = { base: 1 };
  Object.defineProperty(o, "p", d);
  show("4", o.p + 1);
}
// 5: the descriptor inherits its fields
{
  const inherited = Object.create({ value: "inherited" });
  const o = {};
  Object.defineProperty(o, "p", chain(inherited));
  show("5", o.p.length);
  const parent = {};
  const child = Object.create(parent);
  chain(parent).get = () => "late getter";
  const q = {};
  Object.defineProperty(q, "p", child);
  show("5b", q.p.length);
}
// 6: the key arrives late
{
  function define(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: true }); }
  const o = {};
  define(o, "a", 1);
  define(o, chain("b"), "text");
  define(o, dynamic("c"), [1]);
  show("6", o.a + 1, o.b.length, o.c.length);
}
// 7: a map whose keys and descriptors arrive late
{
  const map = { a: { value: 1, enumerable: true } };
  function grow(m) { m.b = { get() { return "getter"; }, enumerable: true }; m[dynamic("c")] = { value: [1], enumerable: true }; }
  grow(chain(map));
  const o = Object.defineProperties({}, map);
  show("7", o.a + 1, o.b.length, o.c.length);
  const created = Object.create({ inherited: true }, chain(map));
  show("7b", created.a + 1, created.b.length, created.c.length, created.inherited);
}
// 8: a receiver that arrives after the map was read
{
  const map = { a: { value: "text" } };
  function define(o) { return Object.defineProperties(o, map); }
  show("8", define({}).a.length, define(chain({ own: 1 })).a.length);
}
// 9: what getOwnPropertyDescriptor hands out is used to define
{
  const source = { get g() { return this.base * 2; }, base: 4 };
  const target = { base: 5 };
  Object.defineProperty(target, "g", chain(Object.getOwnPropertyDescriptor(source, "g")));
  show("9", target.g + 1);
  const all = Object.getOwnPropertyDescriptors(chain(source));
  const clone = Object.defineProperties({}, all);
  show("9b", clone.g + 1, clone.base + 1);
}
// 10: a setter from a descriptor, and a store that was seen before
{
  const log = [];
  function put(o, v) { o.p = v; }
  const plain = {}; put(plain, 1);
  const o = {};
  Object.defineProperty(o, "p", chain({ set(v) { log.push(typeof v); this.kept = v; } }));
  put(o, "text");
  show("10", plain.p + 1, o.p, o.kept.length, log.join());
}
// 11: the descriptor is a primitive or missing first
{
  function define(o, d) { try { Object.defineProperty(o, "p", d); return "defined"; } catch (e) { return e.constructor.name; } }
  const o = {};
  show("11", define(o, undefined), define(o, 5), define(o, chain({ value: "text" })), o.p.length);
}
