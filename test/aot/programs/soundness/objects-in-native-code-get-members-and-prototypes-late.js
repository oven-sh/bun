// An object reaches code nobody sees first. What it holds arrives later, in a function that is found late: a method, a value in a field, an accessor, a prototype, an object behind a property.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
let stash;
const box = new Proxy({}, { set(target, key, value) { stash = value; return true; }, get() { return stash; } });
function hide(value) { box.kept = value; return box.kept; }
// `seen` is undefined at run time: the field is read through a leak of `this` before its store. An analysis learns that late, and only then finds the member `undefined`.
class Leaking { constructor() { leak(this); this.key = "early"; } }
let seen;
function leak(o) { seen = o.key; }
new Leaking();

// 1: a method in a property that is added late
{ const o = { a: 1 }; const u = hide(o); const table = { early() {}, undefined() { o.m = function (x) { return typeof x; }; } }; table[seen](); show("1", u.m("s"), u.m(1), u.m()); }
// 2: a function in a field that held null
{ const o = { callback: null }; const u = hide(o); const table = { early() {}, undefined() { o.callback = function (x) { return typeof x; }; } }; table[seen](); show("2", u.callback("s"), u.callback(1)); }
// 3: the store through the hidden value is seen first, the object is hidden late
{ const o = { a: 1 }; function setA(t) { t.a = "s"; } setA(hide({ a: 2 })); const table = { early() { return { a: 3 }; }, undefined() { return hide(o); } }; setA(table[seen]()); show("3", typeof o.a, o.a); }
// 4: an accessor defined late
{ let hits = 0; const o = { a: 1 }; const u = hide(o);
  const table = { early() {}, undefined() { Object.defineProperty(o, "g", { get() { hits++; return typeof this.a; }, set(v) { hits += 10; this.a = v; } }); } }; table[seen]();
  show("4a", u.g, hits); u.g = "s"; show("4b", u.g, hits, typeof o.a); }
// 5: the prototype is set late, and changed through the hidden value
{ const proto = { tag: 1 }; const o = {}; const u = hide(o); const table = { early() {}, undefined() { Object.setPrototypeOf(o, proto); } }; table[seen]();
  Object.getPrototypeOf(u).tag = "s"; show("5", typeof proto.tag, typeof o.tag); }
// 6: the prototype is changed through a value that is hidden late
{ const o = { a: 1 }; function reparent(t) { Object.setPrototypeOf(t, { m() { return "inherited"; } }); } reparent(hide({}));
  const table = { early() { return {}; }, undefined() { return hide(o); } }; reparent(table[seen]()); show("6", typeof o.m, o.m ? o.m() : "none"); }
// 7: an object behind a property that is filled late
{ const inner = { v: 1 }; const outer = { inner: null }; const u = hide(outer); const table = { early() {}, undefined() { outer.inner = inner; } }; table[seen](); u.inner.v = "s"; show("7", typeof inner.v); }
// 8: the constructor is reached through an instance that is hidden late
{ class A { constructor(v) { this.v = v; } get() { return typeof this.v; } } const a = new A(1); const table = { early() { return a; }, undefined() { return hide(a); } };
  const b = new (table[seen]().constructor)("s"); show("8", a.get(), b.get(), b instanceof A); }
// 9: a static field through a class that is hidden late
{ class S { static s = 1; static get() { return typeof S.s; } } const table = { early() { return { s: 0 }; }, undefined() { return hide(S); } }; table[seen]().s = "s"; show("9", S.get(), typeof S.s); }
