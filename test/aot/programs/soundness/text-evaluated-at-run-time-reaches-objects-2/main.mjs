import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Text evaluated at run time reaches objects of the program: through its operands, through what they reach, through the global object, and through functions it made that travel on.
// Each case has a class of its own, an instance that the text can reach and one that it cannot.
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
const make = (...parts) => Function(...parts.slice(0, -1), glue(parts[parts.length - 1], ""));
const sleep = () => new Promise(r => setTimeout(r, 2));
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('o', 'o.n = "x"; o.list.push("y")').bind(null, o)(); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text comes back through a bound function', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('this.n = "x"; this.list.push("y")').call(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is called with call', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('return function (o) { o.n = "x"; o.list.push("y"); }')()(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is returned by a function from text', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('return { f(o) { o.n = "x"; o.list.push("y"); } }')().f(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('object from text holds the function', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const p = make('o', 'return new Proxy(o, { get(t, k) { if (k === "poke") { t.n = "x"; t.list.push("y"); } return t[k]; } })')(o); p.poke; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('proxy from text stands for the operand', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('o', 'o.constructor.prototype.twice = function () { return "patched"; }')(o); note(other.twice()); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the class is reached from the operand and a method is replaced', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('o', 'Object.defineProperty(Object.getPrototypeOf(o), "fresh", { set(v) { this.n = "x"; this.list.push("y"); }, configurable: true })')(other); o.fresh = 1; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the class is reached from the operand and gets a setter', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const made = make('o', 'const p = new o.constructor(5); p.n = "made"; return p')(other); note(made.twice(), typeof made.n); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the class is reached from the operand and another instance is made', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { C.registry = [o]; make('p', 'const o = p.constructor.registry[0]; o.n = "x"; o.list.push("y")')(other); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('a static member is reached from the operand', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const holder = { inner: o }; make('h', 'h.inner.n = "x"; h.inner.list.push("y")')(holder); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the operand reaches another object through a field', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('f', 'const o = f(); o.n = "x"; o.list.push("y")')(() => o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the operand reaches another object through a closure', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('h', 'const o = h.g; o.n = "x"; o.list.push("y")')({ get g() { return o; } }); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the operand reaches another object through a getter', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('m', 'const o = m.get("k"); o.n = "x"; o.list.push("y")')(new Map([['k', o]])); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the operand reaches another object through a map', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('it', 'for (const o of it) { o.n = "x"; o.list.push("y"); }')([o].values()); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the operand reaches another object through an iterator', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { await make('p', 'return p.then(o => { o.n = "x"; o.list.push("y"); })')(Promise.resolve(o)); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the operand reaches another object through a promise', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { globalThis.shared = o; make('shared.n = "x"; shared.list.push("y")')(); delete globalThis.shared; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the global object holds the object', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
