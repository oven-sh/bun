import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Text evaluated at run time and the program meet again later: through listeners, handlers and callbacks that native code keeps, through containers on the global object that are filled afterwards,
// through accessors, proxies, iterators, thenables and classes that the text made. Each case has a class of its own, an instance that the text can reach and one that it cannot.
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
  try { const t = new EventTarget(); t.addEventListener('e', make('e', 'const o = e.detail; o.n = \"x\"; o.list.push(\"y\")')); t.dispatchEvent(new CustomEvent('e', { detail: o })); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('event target hands the detail to a listener from text', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { class T extends EventTarget { held = o; } const t = new T(); t.addEventListener('e', make('e', 'const o = e.target.held; o.n = \"x\"; o.list.push(\"y\")')); t.dispatchEvent(new Event('e')); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('event target hands itself to a listener from text', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const a = new AbortController(); a.signal.addEventListener('abort', make('e', 'const o = e.target.reason; o.n = \"x\"; o.list.push(\"y\")')); a.abort(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('abort reason reaches a listener from text', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { process.once('soundness', make('o', 'o.n = \"x\"; o.list.push(\"y\")')); process.emit('soundness', o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('process event reaches a listener from text', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const e = new (require('node:events'))(); e.once('e', make('o', 'o.n = \"x\"; o.list.push(\"y\")')); const later = () => e.emit('e', o); later(); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('emitter keeps the listener and the program emits later', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const h = make('o', 'o.n = \"x\"; o.list.push(\"y\")'); process.once('unhandledRejection', h); Promise.reject(o); await sleep(); await sleep(); process.removeListener('unhandledRejection', h); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('unhandled rejection reaches a handler from text', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { globalThis.registry = new Map(); const read = make('return () => { const o = registry.get(\"k\"); o.n = \"x\"; o.list.push(\"y\"); }')(); registry.set('k', o); read(); delete globalThis.registry; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('a map on the global object is filled after the text ran', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { globalThis.queue = []; const read = make('return () => { const o = queue[0]; o.n = \"x\"; o.list.push(\"y\"); }')(); queue.push(o); read(); delete globalThis.queue; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('an array on the global object is filled after the text ran', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { globalThis.state = {}; const read = make('return () => { const o = state.current; o.n = \"x\"; o.list.push(\"y\"); }')(); state.current = o; read(); delete globalThis.state; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('an object on the global object gets the field after the text ran', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('Object.defineProperty(globalThis, \"inbox\", { set(o) { o.n = \"x\"; o.list.push(\"y\"); }, configurable: true })')(); globalThis.inbox = o; delete globalThis.inbox; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('a setter from text on the global object takes what is assigned', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const box = {}; make('b', 'Object.defineProperty(b, \"slot\", { set(o) { o.n = \"x\"; o.list.push(\"y\"); }, configurable: true })')(box); box.slot = o; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('a setter from text on an operand takes what is assigned later', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const box = {}; make('b', 'o', 'Object.defineProperty(b, \"slot\", { get() { o.n = \"x\"; o.list.push(\"y\"); return o; }, configurable: true })')(box, o); note(box.slot === o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('a getter from text answers with an object it kept', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
