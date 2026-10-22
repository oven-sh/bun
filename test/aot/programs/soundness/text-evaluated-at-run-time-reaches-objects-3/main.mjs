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
  try { globalThis.give = () => o; make('const o = give(); o.n = "x"; o.list.push("y")')(); delete globalThis.give; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the global object holds a function that gives the object', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const h = { [Symbol.for('soundness')]: o }; make('h', 'const o = h[Symbol.for("soundness")]; o.n = "x"; o.list.push("y")')(h); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('a registered symbol names the field', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const D = make('B', 'return class extends B { twice() { this.n = "x"; this.list.push("y"); return 0; } }')(C); const d = new D(21); d.twice(); note(typeof d.n, d.total(), d instanceof C); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text subclasses the class', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const f = v => { o.n = v; o.list.push('y'); }; make('f', 'f("x")')(f); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text calls a function of the program with other arguments', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { note(String(make('m', 'return m.call({ n: "s" })')(o.twice))); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text calls a method of the program on another receiver', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const p = make('K', 'return new K("s")')(C); note(String(p.twice()), typeof p.n); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text constructs the class with other arguments', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { try { make('o', 'o.n = "x"; o.list.push("y"); throw o')(o); } catch (e) { note(e === o); }; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text throws the operand changed', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('o', 'delete o.n; Object.freeze(o.list); Object.setPrototypeOf(o, { twice() { return "reparented"; }, total() { return -1; } })')(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text deletes, freezes and reparents', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('o', 'let n = 0; Object.defineProperty(o, "n", { get() { return "g" + n++; } }); o.list.length = 0')(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text redefines a field as an accessor', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { globalThis.shared = o; (0, eval)(glue('shared.n = "x"; shared.list', '.push("y")')); delete globalThis.shared; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('indirect eval reads the global object', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { eval(glue('o.n = "x"; o.list', '.push("y")')); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('direct eval reads a local variable', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { let local = 1; eval(glue('local', ' = "s"')); note(typeof local, local + 1); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('direct eval assigns a local variable', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { eval(glue('var fresh', ' = 5')); note(typeof fresh); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('direct eval declares a variable', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { require('node:vm').runInNewContext(glue('o.n = "x"; o.list', '.push("y")'), { o }); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('vm runs text on a sandbox', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const vm = require('node:vm'); vm.createContext(o); vm.runInContext(glue('n = "x"; list', '.push("y")'), o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('vm contextifies the object itself', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('return 1')(); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('nothing is handed over', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
