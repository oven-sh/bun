// An object goes into a built-in and comes out under another name: a store through that name is seen by reads through the first. Each case has a class, an allocation and a store of its own.
const id = x => x;
class Cell125 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell125(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('class field', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('class field', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new (class { f = c; })().f)(c); if (out instanceof Promise) out.then(done, e => console.log('class field', "rejected", String(e))); else done(out); } catch (e) { console.log('class field', "threw", e.name); }
}
class Cell126 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell126(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('static', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('static', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (class { static f = c; }).f)(c); if (out instanceof Promise) out.then(done, e => console.log('static', "rejected", String(e))); else done(out); } catch (e) { console.log('static', "threw", e.name); }
}
class Cell127 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell127(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('private', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('private', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new (class { #f = c; get() { return this.#f; } })().get())(c); if (out instanceof Promise) out.then(done, e => console.log('private', "rejected", String(e))); else done(out); } catch (e) { console.log('private', "threw", e.name); }
}
class Cell128 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell128(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('super return', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('super return', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new (class extends (class { constructor() { return c; } }) {})())(c); if (out instanceof Promise) out.then(done, e => console.log('super return', "rejected", String(e))); else done(out); } catch (e) { console.log('super return', "threw", e.name); }
}
class Cell129 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell129(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('constructor return', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('constructor return', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new (function () { return c; })())(c); if (out instanceof Promise) out.then(done, e => console.log('constructor return', "rejected", String(e))); else done(out); } catch (e) { console.log('constructor return', "threw", e.name); }
}
class Cell130 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell130(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('symbol key', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('symbol key', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const s = Symbol(); return { [s]: c }[s]; })(c); if (out instanceof Promise) out.then(done, e => console.log('symbol key', "rejected", String(e))); else done(out); } catch (e) { console.log('symbol key', "threw", e.name); }
}
class Cell131 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell131(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('computed', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('computed', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ({ ["a" + 1]: c }).a1)(c); if (out instanceof Promise) out.then(done, e => console.log('computed', "rejected", String(e))); else done(out); } catch (e) { console.log('computed', "threw", e.name); }
}
class Cell132 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell132(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('index key', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('index key', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ({ 0: c })[0])(c); if (out instanceof Promise) out.then(done, e => console.log('index key', "rejected", String(e))); else done(out); } catch (e) { console.log('index key', "threw", e.name); }
}
class Cell133 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell133(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('globalThis', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('globalThis', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { globalThis.__cell = c; const r = globalThis.__cell; delete globalThis.__cell; return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('globalThis', "rejected", String(e))); else done(out); } catch (e) { console.log('globalThis', "threw", e.name); }
}
class Cell134 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell134(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('closure', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('closure', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (() => () => c)()())(c); if (out instanceof Promise) out.then(done, e => console.log('closure', "rejected", String(e))); else done(out); } catch (e) { console.log('closure', "threw", e.name); }
}
class Cell135 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell135(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('JSON reviver', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('JSON reviver', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => JSON.parse("[0]", (k, v) => (k === "0" ? c : v))[0])(c); if (out instanceof Promise) out.then(done, e => console.log('JSON reviver', "rejected", String(e))); else done(out); } catch (e) { console.log('JSON reviver', "threw", e.name); }
}
class Cell136 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell136(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('JSON replacer this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('JSON replacer this', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; JSON.stringify({ k: c }, function (k, v) { if (k === "n") r = this; return v; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('JSON replacer this', "rejected", String(e))); else done(out); } catch (e) { console.log('JSON replacer this', "threw", e.name); }
}
class Cell137 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell137(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('toJSON this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toJSON this', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; c.toJSON = function () { r = this; return 0; }; JSON.stringify(c); delete c.toJSON; return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('toJSON this', "rejected", String(e))); else done(out); } catch (e) { console.log('toJSON this', "threw", e.name); }
}
class Cell138 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell138(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('replace fn', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('replace fn', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; "a".replace("a", () => { r = c; return ""; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('replace fn', "rejected", String(e))); else done(out); } catch (e) { console.log('replace fn', "threw", e.name); }
}
class Cell139 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell139(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('toString this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toString this', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; c.toString = function () { r = this; return ""; }; `${c}`; delete c.toString; return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('toString this', "rejected", String(e))); else done(out); } catch (e) { console.log('toString this', "threw", e.name); }
}
class Cell140 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell140(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('structuredClone', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('structuredClone', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (structuredClone({ n: 1 }), c))(c); if (out instanceof Promise) out.then(done, e => console.log('structuredClone', "rejected", String(e))); else done(out); } catch (e) { console.log('structuredClone', "threw", e.name); }
}
class Cell141 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell141(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('AbortSignal', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('AbortSignal', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => AbortSignal.abort(c).reason)(c); if (out instanceof Promise) out.then(done, e => console.log('AbortSignal', "rejected", String(e))); else done(out); } catch (e) { console.log('AbortSignal', "threw", e.name); }
}
class Cell142 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell142(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('abort', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('abort', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const a = new AbortController(); a.abort(c); return a.signal.reason; })(c); if (out instanceof Promise) out.then(done, e => console.log('abort', "rejected", String(e))); else done(out); } catch (e) { console.log('abort', "threw", e.name); }
}
class Cell143 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell143(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('CustomEvent', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('CustomEvent', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new CustomEvent("e", { detail: c }).detail)(c); if (out instanceof Promise) out.then(done, e => console.log('CustomEvent', "rejected", String(e))); else done(out); } catch (e) { console.log('CustomEvent', "threw", e.name); }
}
class Cell144 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell144(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('dispatch', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('dispatch', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; const t = new EventTarget(); t.addEventListener("e", e => { r = e.detail; }); t.dispatchEvent(new CustomEvent("e", { detail: c })); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('dispatch', "rejected", String(e))); else done(out); } catch (e) { console.log('dispatch', "threw", e.name); }
}
class Cell145 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell145(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('emitter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('emitter', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; const e = new (require("node:events"))(); e.on("e", v => { r = v; }); e.emit("e", c); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('emitter', "rejected", String(e))); else done(out); } catch (e) { console.log('emitter', "threw", e.name); }
}
class Cell146 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell146(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('emitter this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('emitter this', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const E = require("node:events"); let r; const e = new E(); e.cell = c; e.on("e", function () { r = this.cell; }); e.emit("e"); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('emitter this', "rejected", String(e))); else done(out); } catch (e) { console.log('emitter this', "threw", e.name); }
}
class Cell147 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell147(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('AsyncLocalStorage', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('AsyncLocalStorage', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const { AsyncLocalStorage } = require("node:async_hooks"); const s = new AsyncLocalStorage(); return s.run(c, () => s.getStore()); })(c); if (out instanceof Promise) out.then(done, e => console.log('AsyncLocalStorage', "rejected", String(e))); else done(out); } catch (e) { console.log('AsyncLocalStorage', "threw", e.name); }
}
class Cell148 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell148(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('util.inspect', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('util.inspect', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; c[require("node:util").inspect.custom] = function () { r = this; return ""; }; require("node:util").inspect(c); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('util.inspect', "rejected", String(e))); else done(out); } catch (e) { console.log('util.inspect', "threw", e.name); }
}
class Cell149 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell149(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Promise.resolve', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Promise.resolve', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.resolve(c))(c); if (out instanceof Promise) out.then(done, e => console.log('Promise.resolve', "rejected", String(e))); else done(out); } catch (e) { console.log('Promise.resolve', "threw", e.name); }
}
