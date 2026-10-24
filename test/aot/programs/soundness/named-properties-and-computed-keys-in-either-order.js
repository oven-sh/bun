// Named properties and stores under keys nobody can name, in either order.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { console.log(parts.map(String).join(" | ")); }
function dynamic(text) { return (text + "!").slice(0, text.length); }

// 1: the name first, the unnamed store late
{
  const o = {}; o.a = 1;
  function read(x) { return x.a; }
  show("1a", read(o) + 1);
  function put(x, k, v) { x[k] = v; }
  put(chain(o), dynamic("a"), "text");
  show("1b", read(o).length);
}
// 2: the unnamed store first, the name is created late
{
  const o = {};
  function put(x, k, v) { x[k] = v; }
  put(o, dynamic("a"), "text");
  function read(x) { return x.a; }
  show("2a", read(o).length);
  function name(x) { x.a = 5; x.b = 6; }
  name(chain(o));
  put(o, dynamic("b"), [1, 2]);
  show("2b", read(o) + 1, o.b.length);
}
// 3: a field of a literal
{
  const o = { a: 1, b: 2 };
  function read(x) { return x.a; }
  show("3a", read(o) + 1);
  o[dynamic("a")] = "text";
  show("3b", read(o).length, o.b + 1);
}
// 4: a field of a class
{
  class C { constructor() { this.a = 1; this.b = 2; } }
  const o = new C();
  function read(x) { return x.a; }
  show("4a", read(o) + 1);
  function put(x, k, v) { x[k] = v; }
  put(chain(o), dynamic("a"), { deep: 1 });
  show("4b", read(o).deep, new C().a + 1);
}
// 5: symbols
{
  const s = Symbol("s"), t = Symbol("t");
  const o = { [s]: 1 };
  function read(x) { return x[s]; }
  show("5a", read(o) + 1);
  const found = Object.getOwnPropertySymbols(chain(o))[0];
  o[found] = "text";
  show("5b", read(o).length);
  const p = {};
  p[Object.getOwnPropertySymbols({ [t]: 0 })[0]] = "unnamed";
  show("5c", p[t].length);
  p[t] = 3;
  show("5d", p[t] + 1);
}
// 6: indexes of a plain object and of an array
{
  const o = { 0: 1 };
  function read(x) { return x[0]; }
  show("6a", read(o) + 1);
  o[Number(dynamic("0"))] = "text";
  show("6b", read(o).length);
  const list = [1, 2, 3];
  show("6c", read(list) + 1);
  list[Number(dynamic("0"))] = "text";
  show("6d", read(list).length, list[1] + 1);
  list[dynamic("1")] = [1];
  show("6e", list[1].length);
}
// 7: read under a key nobody can name, names created late
{
  const o = { a: 1 };
  function read(x, k) { return x[k]; }
  show("7a", read(o, dynamic("a")) + 1);
  function grow(x) { x.late = "text"; Object.defineProperty(x, "getter", { get() { return [1]; }, enumerable: true }); }
  grow(chain(o));
  show("7b", read(o, dynamic("late")).length, read(o, dynamic("getter")).length);
}
// 8: on a prototype: the unnamed store lands above the receiver
{
  const proto = {};
  const o = Object.create(proto);
  function read(x) { return x.m; }
  show("8a", read(o));
  proto[dynamic("m")] = () => "called";
  show("8b", read(o)());
  const proto2 = { m: 1 };
  const o2 = Object.create(proto2);
  show("8c", read(o2) + 1);
  chain(proto2)[dynamic("m")] = "text";
  show("8d", read(o2).length);
}
// 9: an accessor under a key nobody can name
{
  const o = { a: 1 };
  function read(x) { return x.a; }
  show("9a", read(o) + 1);
  Object.defineProperty(chain(o), dynamic("a"), { get() { return "getter"; } });
  show("9b", read(o).length);
}
// 10: Object.assign and spread as the unnamed store
{
  const o = { a: 1 };
  function read(x) { return x.a; }
  show("10a", read(o) + 1);
  Object.assign(chain(o), JSON.parse('{"a":"text"}'));
  show("10b", read(o).length);
}
