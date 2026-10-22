// Static members, super calls, accessors and methods that conversions, built-ins and heirs find at run time.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("constructor-property");
  class C { m() { return new this.constructor(); } x = 3; }
  print(new C().m().x);
}
{
  const print = printer("species");
  class A extends Array { static get [Symbol.species]() { return Array; } }
  const a = new A(1, 2, 3);
  print(a.slice(0) instanceof A);
}
{
  const print = printer("static-call");
  class C { static m() { return 1; } }
  print(C.m());
}
{
  const print = printer("static-field-by-conversion");
  class C { static x = 4; static valueOf() { return C.x; } }
  print(C + 1);
}
{
  const print = printer("static-field-never-read");
  class C { static x = 4; }
  print(Object.keys(C).length);
}
{
  const print = printer("static-field-stringify");
  class C { static x = 4; }
  print(JSON.stringify({ ...C }));
}
{
  const print = printer("static-inherited-conversion");
  class B { static toString() { return "B!"; } }
  class C extends B {}
  print(`${C}`);
}
{
  const print = printer("static-inherited");
  class B { static m() { return 1; } }
  class C extends B {}
  print(C.m());
}
{
  const print = printer("static-this");
  class C { static make() { return new this(); } x = 2; }
  print(C.make().x);
}
{
  const print = printer("accessor-by-conversion");
  class C { get valueOf() { return () => 6; } }
  print(new C() + 1);
}
{
  const print = printer("array-index-conversion");
  const o = { toString() { return "1"; } };
  print([10, 20, 30][o]);
}
{
  const print = printer("array-join-native");
  const o = { toString() { return "x"; } };
  print(String([o, o]));
}
{
  const print = printer("array-length-store");
  const o = { valueOf() { return 1; } };
  const t = [1, 2, 3];
  t.length = o;
  print(t.length);
}
{
  const print = printer("bigint-conversion");
  const o = { valueOf() { return 2n; } };
  print(o * 3n);
}
{
  const print = printer("callback-field");
  const o = { done(v) { print("done", v); } };
  async function g() { return 4; }
  g().then(o.done);
}
{
  const print = printer("class-getter-not-stringified");
  class C { get a() { return 1; } b = 2; }
  print(JSON.stringify(new C()));
}
{
  const print = printer("date-to-primitive");
  const o = { [Symbol.toPrimitive](hint) { return hint === "default" ? 10 : 20; } };
  print(new Date(o).getTime());
}
{
  const print = printer("error-subclass");
  class E extends Error { name = "E"; }
  print(`${new E("m")}`);
}
{
  const print = printer("error-thrown");
  class E extends Error { constructor(m) { super(m); this.code = 3; } }
  try { throw new E("m"); } catch (e) { print(e.code, e.message); }
}
{
  const print = printer("field-shadowed");
  const p = { m() { return 1; } };
  const o = Object.create(p);
  print(o.m());
  o.m = function () { return 2; };
  print(o.m());
  delete o.m;
  print(o.m());
}
{
  const print = printer("frozen");
  const o = Object.freeze({ valueOf() { return 2; } });
  print(o + 1);
}
{
  const print = printer("generator-method");
  const o = { *[Symbol.iterator]() { yield 1; yield 2; } };
  for (const x of o) print(x);
}
{
  const print = printer("getter-stringify");
  const o = { get a() { return 1; } };
  print(JSON.stringify(o));
}
{
  const print = printer("getter-through-prototype");
  const p = { get a() { return 9; } };
  const o = Object.create(p);
  print(o.a);
}
{
  const print = printer("heir-escapes");
  const p = { toString() { return "escaped"; } };
  const o = Object.create(p);
  print(o);
}
{
  const print = printer("json-parse-reviver-field");
  const h = { revive(k, v) { return typeof v === "number" ? v + 1 : v; } };
  print(JSON.parse('{"a":1}', h.revive).a);
}
{
  const print = printer("json-replacer-function-field");
  const h = { replace(k, v) { return typeof v === "number" ? v + 1 : v; } };
  print(JSON.stringify({ a: 1 }, h.replace));
}
{
  const print = printer("json-space");
  const o = { a: 1 };
  print(JSON.stringify(o, null, { valueOf() { return 1; } } + 0));
}
{
  const print = printer("many-heirs");
  const p = { m() { return this.x; } };
  function make(x) { const o = Object.create(p); o.x = x; return o; }
  let s = 0;
  for (let i = 0; i < 10; i++) s += make(i).m();
  print(s);
}
{
  const print = printer("mixed-receivers");
  const p = { m() { return 1; } };
  const a = Object.create(p);
  const b = { m() { return 2; } };
  class C { m() { return 3; } }
  const list = [a, b, new C()];
  let s = "";
  for (let i = 0; i < list.length; i++) s += list[i].m();
  print(s);
}
{
  const print = printer("number-key-call");
  const o = { 0() { return 8; } };
  print(o[0]());
}
{
  const print = printer("own-and-inherited");
  const p = { m() { return 1; } };
  const o = Object.create(p);
  print(p.m() + o.m());
}
{
  const print = printer("own-call-and-conversion");
  const o = { valueOf() { return 1; } };
  print(o.valueOf() + (o + 1));
}
{
  const print = printer("own-call-inherited-conversion");
  const p = { valueOf() { return 1; } };
  const o = Object.create(p);
  print(p.valueOf() + (o + 1));
}
{
  const print = printer("private-method");
  class C { #m() { return 1; } valueOf() { return this.#m(); } }
  print(new C() + 1);
}
{
  const print = printer("prototype-field-deleted");
  const p = { m() { return 1; } };
  const o = Object.create(p);
  print(o.m());
  delete p.m;
  print(typeof o.m);
}
{
  const print = printer("prototype-field-replaced");
  const p = { m() { return 1; } };
  const o = Object.create(p);
  print(o.m());
  p.m = function () { return 2; };
  print(o.m());
}
{
  const print = printer("prototype-swapped");
  const p = { m() { return 1; } };
  const q = { m() { return 2; } };
  const o = Object.create(p);
  print(o.m());
  Object.setPrototypeOf(o, q);
  print(o.m());
}
{
  const print = printer("relational-two-objects");
  const a = { valueOf() { return 1; } };
  const b = { valueOf() { return 2; } };
  print(a < b, a + b);
}
{
  const print = printer("setter-by-assign");
  const o = { set a(v) { print("set", v); } };
  Object.assign(o, { a: 1 });
}
{
  const print = printer("setter-through-prototype");
  const p = { set a(v) { print("set", v); } };
  const o = Object.create(p);
  o.a = 1;
}
{
  const print = printer("sort-comparator-field");
  const o = { compare(a, b) { return b - a; } };
  const list = [1, 3, 2];
  list.sort(o.compare);
  print(list[0], list[1], list[2]);
}
{
  const print = printer("string-method-argument");
  const o = { toString() { return "b"; } };
  print("abc".indexOf(o), "abc".charAt({ valueOf() { return 1; } }));
}
{
  const print = printer("super-conversion");
  class B { valueOf() { return 1; } }
  class C extends B { valueOf() { return super.valueOf() + 1; } }
  print(new C() + 1);
}
{
  const print = printer("super-literal");
  const p = { m() { return 1; } };
  const o = { __proto__: p, m() { return super.m() + 1; } };
  print(o.m());
}
{
  const print = printer("super-method");
  class B { m() { return 1; } }
  class C extends B { m() { return super.m() + 1; } }
  print(new C().m());
}
{
  const print = printer("super-property");
  const p = { x: 4 };
  const o = { __proto__: p, m() { return super.x; } };
  print(o.m());
}
{
  const print = printer("switch-loose");
  const o = { valueOf() { return 1; } };
  if (o == 1) print("equal"); else print("different");
}
{
  const print = printer("symbol-key-call");
  const k = Symbol("k");
  const o = { [k]() { return 8; } };
  print(o[k]());
}
{
  const print = printer("symbol-key-through-prototype");
  const k = Symbol("k");
  const p = { [k]() { return 8; } };
  const o = Object.create(p);
  print(o[k]());
}
{
  const print = printer("typed-array-store");
  const o = { valueOf() { return 7; } };
  const t = new Uint8Array(1);
  t[0] = o;
  print(t[0]);
}
{
  const print = printer("with-null-prototype");
  const o = Object.create(null);
  o.toString = function () { return "bare"; };
  print(`${o}`);
}
{
  const print = printer("call");
  class C { #m() { return 1; } n() { return this.#m(); } }
  print(new C().n());
}
{
  const print = printer("conversion");
  class C { #m() { return 1; } valueOf() { return this.#m(); } }
  print(new C() + 1);
}
{
  const print = printer("field-conversion");
  class C { #x = 1; valueOf() { return this.#x; } }
  print(new C() + 1);
}
{
  const print = printer("getter");
  class C { get #x() { return 1; } n() { return this.#x; } }
  print(new C().n());
}
{
  const print = printer("static");
  class C { static #m() { return 1; } static n() { return C.#m(); } }
  print(C.n());
}
{
  const print = printer("value");
  class C { #m() { return 1; } n() { const f = this.#m; return f(); } }
  print(new C().n());
}

await new Promise(resolve => setTimeout(resolve, 0));
console.log(lines.join("\n"));
