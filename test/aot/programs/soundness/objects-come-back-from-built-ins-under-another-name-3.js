// An object goes into a built-in and comes out under another name: a store through that name is seen by reads through the first. Each case has a class, an allocation and a store of its own.
const id = x => x;
class Cell50 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell50(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('for in', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('for in', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const o = { k: c }; for (const k in o) return o[k]; })(c); if (out instanceof Promise) out.then(done, e => console.log('for in', "rejected", String(e))); else done(out); } catch (e) { console.log('for in', "threw", e.name); }
}
class Cell51 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell51(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('iterator map', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('iterator map', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].values().map(id).toArray()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('iterator map', "rejected", String(e))); else done(out); } catch (e) { console.log('iterator map', "threw", e.name); }
}
class Cell52 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell52(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('iterator filter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('iterator filter', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].values().filter(() => true).next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('iterator filter', "rejected", String(e))); else done(out); } catch (e) { console.log('iterator filter', "threw", e.name); }
}
class Cell53 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell53(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('iterator find', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('iterator find', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].values().find(() => true))(c); if (out instanceof Promise) out.then(done, e => console.log('iterator find', "rejected", String(e))); else done(out); } catch (e) { console.log('iterator find', "threw", e.name); }
}
class Cell54 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell54(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Iterator.from', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Iterator.from', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Iterator.from([c]).next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('Iterator.from', "rejected", String(e))); else done(out); } catch (e) { console.log('Iterator.from', "threw", e.name); }
}
class Cell55 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell55(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('includes index', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('includes index', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const a = [c]; return a[a.indexOf(c)]; })(c); if (out instanceof Promise) out.then(done, e => console.log('includes index', "rejected", String(e))); else done(out); } catch (e) { console.log('includes index', "threw", e.name); }
}
class Cell56 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell56(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('join free', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('join free', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const a = [c]; a.join; return a[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('join free', "rejected", String(e))); else done(out); } catch (e) { console.log('join free', "threw", e.name); }
}
class Cell57 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell57(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Object.values', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.values', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.values({ k: c })[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Object.values', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.values', "threw", e.name); }
}
class Cell58 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell58(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Object.entries', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.entries', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.entries({ k: c })[0][1])(c); if (out instanceof Promise) out.then(done, e => console.log('Object.entries', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.entries', "threw", e.name); }
}
class Cell59 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell59(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Object.fromEntries', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.fromEntries', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.fromEntries([["k", c]]).k)(c); if (out instanceof Promise) out.then(done, e => console.log('Object.fromEntries', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.fromEntries', "threw", e.name); }
}
class Cell60 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell60(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Object.assign', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.assign', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.assign({}, { k: c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('Object.assign', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.assign', "threw", e.name); }
}
class Cell61 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell61(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Object.assign target', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.assign target', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.assign(c, {}))(c); if (out instanceof Promise) out.then(done, e => console.log('Object.assign target', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.assign target', "threw", e.name); }
}
class Cell62 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell62(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('object spread', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('object spread', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ({ ...{ k: c } }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('object spread', "rejected", String(e))); else done(out); } catch (e) { console.log('object spread', "threw", e.name); }
}
class Cell63 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell63(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Object.create', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object.create', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.getPrototypeOf(Object.create(c)))(c); if (out instanceof Promise) out.then(done, e => console.log('Object.create', "rejected", String(e))); else done(out); } catch (e) { console.log('Object.create', "threw", e.name); }
}
class Cell64 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell64(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('setPrototypeOf', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('setPrototypeOf', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.getPrototypeOf(Object.setPrototypeOf({}, c)))(c); if (out instanceof Promise) out.then(done, e => console.log('setPrototypeOf', "rejected", String(e))); else done(out); } catch (e) { console.log('setPrototypeOf', "threw", e.name); }
}
class Cell65 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell65(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('setPrototypeOf result', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('setPrototypeOf result', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.setPrototypeOf(c, Cell.prototype))(c); if (out instanceof Promise) out.then(done, e => console.log('setPrototypeOf result', "rejected", String(e))); else done(out); } catch (e) { console.log('setPrototypeOf result', "threw", e.name); }
}
class Cell66 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell66(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('__proto__', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('__proto__', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ({ __proto__: c }).__proto__)(c); if (out instanceof Promise) out.then(done, e => console.log('__proto__', "rejected", String(e))); else done(out); } catch (e) { console.log('__proto__', "threw", e.name); }
}
class Cell67 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell67(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('inherit read', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('inherit read', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.create({ k: c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('inherit read', "rejected", String(e))); else done(out); } catch (e) { console.log('inherit read', "threw", e.name); }
}
class Cell68 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell68(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('descriptor', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('descriptor', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.getOwnPropertyDescriptor({ k: c }, "k").value)(c); if (out instanceof Promise) out.then(done, e => console.log('descriptor', "rejected", String(e))); else done(out); } catch (e) { console.log('descriptor', "threw", e.name); }
}
class Cell69 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell69(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('descriptors', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('descriptors', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.getOwnPropertyDescriptors({ k: c }).k.value)(c); if (out instanceof Promise) out.then(done, e => console.log('descriptors', "rejected", String(e))); else done(out); } catch (e) { console.log('descriptors', "threw", e.name); }
}
class Cell70 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell70(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('defineProperty', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('defineProperty', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.defineProperty({}, "k", { value: c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('defineProperty', "rejected", String(e))); else done(out); } catch (e) { console.log('defineProperty', "threw", e.name); }
}
class Cell71 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell71(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('defineProperty result', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('defineProperty result', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.defineProperty(c, "extra", { value: 1 }))(c); if (out instanceof Promise) out.then(done, e => console.log('defineProperty result', "rejected", String(e))); else done(out); } catch (e) { console.log('defineProperty result', "threw", e.name); }
}
class Cell72 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell72(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('defineProperties', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('defineProperties', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.defineProperties({}, { k: { value: c } }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('defineProperties', "rejected", String(e))); else done(out); } catch (e) { console.log('defineProperties', "threw", e.name); }
}
class Cell73 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell73(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('getter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('getter', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ({ get k() { return c; } }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('getter', "rejected", String(e))); else done(out); } catch (e) { console.log('getter', "threw", e.name); }
}
class Cell74 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell74(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('define getter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('define getter', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.defineProperty({}, "k", { get: () => c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('define getter', "rejected", String(e))); else done(out); } catch (e) { console.log('define getter', "threw", e.name); }
}
