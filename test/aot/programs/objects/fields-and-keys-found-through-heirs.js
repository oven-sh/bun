// Fields, methods and keys of an object that are found through a proxy or through the objects that inherit from it.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("assign-heir");
  const c = Object.assign({}, Object.create({ a: 1 }));
  print(c.a);
}
{
  const print = printer("comma-call");
  let holder;
  function make(n) { return { run: () => n, n }; }
  function use() { return (0, holder.run)(); }
  holder = make(4);
  print(use());
}
{
  const print = printer("for-in-class-prototype-assigned");
  class C { x = 1; }
  C.prototype.extra = 2;
  for (const k in new C()) print(k);
}
{
  const print = printer("for-in-constructor-this");
  function P() { this.a = 1; this.b = 2; }
  const o = Object.create(new P());
  let n = 0;
  for (const k in o) n++;
  print(n);
}
{
  const print = printer("for-in-order");
  function make() { const p = {}; p.z = 1; p.a = 2; p.m = 3; return p; }
  const o = Object.create(make());
  let s = "";
  for (const k in o) s += k;
  print(s);
}
{
  const print = printer("for-in-shadowed");
  class P { a = 1; b = 2; }
  const o = Object.create(new P());
  o.a = 5;
  let s = "";
  for (const k in o) s += k + o[k];
  print(s);
}
{
  const print = printer("for-in-swapped-prototype");
  const a = { first: 1 };
  const b = { second: 2 };
  const o = Object.create(a);
  function list(x) { let s = ""; for (const k in x) s += k; return s; }
  print(list(o));
  Object.setPrototypeOf(o, b);
  print(list(o));
}
{
  const print = printer("for-in-three-levels");
  class A { a = 1; }
  class B { b = 2; }
  const top = new A();
  const middle = new B();
  Object.setPrototypeOf(middle, top);
  const o = Object.create(middle);
  o.own = 3;
  let s = "";
  for (const k in o) s += k + ",";
  print(s);
}
{
  const print = printer("get-prototype-read");
  class C { a = 7; }
  const o = Object.create(new C());
  print(Object.getPrototypeOf(o).a);
}
{
  const print = printer("instanceof-prototype-field");
  function F() {}
  const holder = { prototype: F.prototype, [Symbol.hasInstance]: undefined };
  print(typeof holder.prototype);
}
{
  const print = printer("is-prototype-of");
  const p = { a: 1 };
  const o = Object.create(p);
  print(p.isPrototypeOf(o), Object.getPrototypeOf(o) === p, Object.getPrototypeOf(o).a);
}
{
  const print = printer("locale-string-class");
  class C { toString() { return "c"; } }
  print(new C().toLocaleString());
}
{
  const print = printer("locale-string-literal");
  print(({ toString() { return "l"; } }).toLocaleString());
}
{
  const print = printer("own-symbols");
  const k = Symbol("k");
  const o = { [k]: 1 };
  print(Object.getOwnPropertySymbols(o).length);
}
{
  const print = printer("pattern-call");
  let holder;
  function make(n) { return { run: () => { print("ran"); }, n }; }
  function use() { const { run } = holder; run(); return holder.n; }
  holder = make(1);
  print(use());
  holder = make(2);
  print(use());
}
{
  const print = printer("property-is-enumerable");
  const o = { a: 1 };
  print(o.propertyIsEnumerable("a"));
}
{
  const print = printer("proto-getter-read");
  class C { a = 7; }
  const o = Object.create(new C());
  print(o.__proto__.a);
}
{
  const print = printer("proxy-target-field");
  const t = { a: 1 };
  const p = new Proxy(t, {});
  print(p.a);
}
{
  const print = printer("proxy-target-keys");
  const t = { a: 1, b: 2 };
  print(Object.keys(new Proxy(t, {})).length);
}
{
  const print = printer("proxy-target-method");
  const t = { m() { return 2; } };
  const p = new Proxy(t, {});
  print(p.m());
}
{
  const print = printer("pure-call-dropped");
  let holder;
  function make(n) { return { run: () => {}, n }; }
  function use() { holder.run(); return holder.n; }
  holder = make(1);
  print(use());
  print(typeof holder.n);
}
{
  const print = printer("stringify-heir");
  print(JSON.stringify(Object.create({ a: 1 })));
}
{
  const print = printer("variable-call");
  let holder;
  function make(n) { return { run: () => { print("ran"); }, n }; }
  function use() { const f = holder.run; f(); return holder.n; }
  holder = make(1);
  print(use());
}

await new Promise(resolve => setTimeout(resolve, 0));
console.log(lines.join("\n"));
