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
  try { make('o', 'o.n = "x"; o.list.push("y")')(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('operand is changed at once', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const later = make('o', 'return () => { o.n = "x"; o.list.push("y"); }')(o); first(); later(); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('operand is kept and changed later', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('o', 'setTimeout(() => { o.n = "x"; o.list.push("y"); }, 0)')(o); await sleep(); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('operand is changed on a timer', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('o', 'queueMicrotask(() => { o.n = "x"; o.list.push("y"); })')(o); await null; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('operand is changed in a microtask', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const fs = [make('o', 'o.n = "x"; o.list.push("y")')]; fs[0](o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is stored in an array and called later', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const m = new Map([['k', make('o', 'o.n = "x"; o.list.push("y")')]]); m.get('k')(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is stored in a map and called later', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { globalThis.hook = make('o', 'o.n = "x"; o.list.push("y")'); hook(o); delete globalThis.hook; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is stored on the global object', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { setTimeout(make('o', 'o.n = "x"; o.list.push("y")'), 0, o); await sleep(); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is a timer callback', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { await Promise.resolve(o).then(make('o', 'o.n = "x"; o.list.push("y")')); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is a promise reaction', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const e = new (require('node:events'))(); e.on('e', make('o', 'o.n = "x"; o.list.push("y")')); e.emit('e', o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is an event listener', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { [o].forEach(make('o', 'o.n = "x"; o.list.push("y")')); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is a callback of forEach', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { [o, o].sort(make('a', 'b', 'a.n = "x"; if (a.list.length < 3) a.list.push("y"); return 0')); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is a sort comparator', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { JSON.stringify({ k: o }, make('k', 'v', 'if (k === "k") { v.n = "x"; v.list.push("y"); } return v')); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text is a replacer', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { o.patch = make('this.n = "x"; this.list.push("y")'); o.patch(); delete o.patch; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text becomes a method', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { Object.defineProperty(o, 'g', { get: make('this.n = "x"; this.list.push("y"); return 1'), configurable: true }); o.g; delete o.g; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text becomes a getter', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { o.valueOf = make('this.n = "x"; this.list.push("y"); return 1'); +o; delete o.valueOf; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('function from text becomes valueOf', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
