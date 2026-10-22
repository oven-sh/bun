// An object goes into a built-in and comes out under another name: a store through that name is seen by reads through the first. Each case has a class, an allocation and a store of its own.
const id = x => x;
class Cell100 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell100(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Map copy', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map copy', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Map(new Map([["k", c]])).get("k"))(c); if (out instanceof Promise) out.then(done, e => console.log('Map copy', "rejected", String(e))); else done(out); } catch (e) { console.log('Map copy', "threw", e.name); }
}
class Cell101 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell101(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Set', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Set', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [...new Set([c])][0])(c); if (out instanceof Promise) out.then(done, e => console.log('Set', "rejected", String(e))); else done(out); } catch (e) { console.log('Set', "threw", e.name); }
}
class Cell102 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell102(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Set add', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Set add', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Set().add(c).values().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('Set add', "rejected", String(e))); else done(out); } catch (e) { console.log('Set add', "threw", e.name); }
}
class Cell103 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell103(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Set forEach', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Set forEach', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; new Set([c]).forEach(v => { r = v; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('Set forEach', "rejected", String(e))); else done(out); } catch (e) { console.log('Set forEach', "threw", e.name); }
}
class Cell104 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell104(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Set union', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Set union', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [...new Set([c]).union(new Set())][0])(c); if (out instanceof Promise) out.then(done, e => console.log('Set union', "rejected", String(e))); else done(out); } catch (e) { console.log('Set union', "threw", e.name); }
}
class Cell105 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell105(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('WeakMap', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('WeakMap', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const k = {}; return new WeakMap([[k, c]]).get(k); })(c); if (out instanceof Promise) out.then(done, e => console.log('WeakMap', "rejected", String(e))); else done(out); } catch (e) { console.log('WeakMap', "threw", e.name); }
}
class Cell106 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell106(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('WeakRef', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('WeakRef', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new WeakRef(c).deref())(c); if (out instanceof Promise) out.then(done, e => console.log('WeakRef', "rejected", String(e))); else done(out); } catch (e) { console.log('WeakRef', "threw", e.name); }
}
class Cell107 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell107(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Proxy', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Proxy', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const p = new Proxy(c, {}); p.n = 21; return Reflect.getPrototypeOf(p) === Cell.prototype ? c : null; })(c); if (out instanceof Promise) out.then(done, e => console.log('Proxy', "rejected", String(e))); else done(out); } catch (e) { console.log('Proxy', "threw", e.name); }
}
class Cell108 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell108(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Proxy target', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Proxy target', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; new Proxy(c, { get(t) { r = t; } }).x; return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('Proxy target', "rejected", String(e))); else done(out); } catch (e) { console.log('Proxy target', "threw", e.name); }
}
class Cell109 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell109(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Proxy receiver', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Proxy receiver', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; Reflect.get(new Proxy({}, { get(t, k, rc) { r = rc; } }), "k", c); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('Proxy receiver', "rejected", String(e))); else done(out); } catch (e) { console.log('Proxy receiver', "threw", e.name); }
}
class Cell110 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell110(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Error cause', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Error cause', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Error("m", { cause: c }).cause)(c); if (out instanceof Promise) out.then(done, e => console.log('Error cause', "rejected", String(e))); else done(out); } catch (e) { console.log('Error cause', "threw", e.name); }
}
class Cell111 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell111(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('AggregateError', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('AggregateError', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new AggregateError([c]).errors[0])(c); if (out instanceof Promise) out.then(done, e => console.log('AggregateError', "rejected", String(e))); else done(out); } catch (e) { console.log('AggregateError', "threw", e.name); }
}
class Cell112 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell112(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('throw', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('throw', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { try { throw c; } catch (e) { return e; } })(c); if (out instanceof Promise) out.then(done, e => console.log('throw', "rejected", String(e))); else done(out); } catch (e) { console.log('throw', "threw", e.name); }
}
class Cell113 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell113(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('generator', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('generator', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (function* () { yield c; })().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('generator', "rejected", String(e))); else done(out); } catch (e) { console.log('generator', "threw", e.name); }
}
class Cell114 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell114(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('generator send', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('generator send', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const g = (function* () { return yield; })(); g.next(); return g.next(c).value; })(c); if (out instanceof Promise) out.then(done, e => console.log('generator send', "rejected", String(e))); else done(out); } catch (e) { console.log('generator send', "threw", e.name); }
}
class Cell115 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell115(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('generator return', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('generator return', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (function* () {})().return(c).value)(c); if (out instanceof Promise) out.then(done, e => console.log('generator return', "rejected", String(e))); else done(out); } catch (e) { console.log('generator return', "threw", e.name); }
}
class Cell116 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell116(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('yield star', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('yield star', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (function* () { yield* [c]; })().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('yield star', "rejected", String(e))); else done(out); } catch (e) { console.log('yield star', "threw", e.name); }
}
class Cell117 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell117(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('generator throw', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('generator throw', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const g = (function* () { try { yield; } catch (e) { yield e; } })(); g.next(); return g.throw(c).value; })(c); if (out instanceof Promise) out.then(done, e => console.log('generator throw', "rejected", String(e))); else done(out); } catch (e) { console.log('generator throw', "threw", e.name); }
}
class Cell118 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell118(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('tagged', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('tagged', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ((s, v) => v)`${c}`)(c); if (out instanceof Promise) out.then(done, e => console.log('tagged', "rejected", String(e))); else done(out); } catch (e) { console.log('tagged', "threw", e.name); }
}
class Cell119 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell119(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('optional', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('optional', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ({ k: c })?.k)(c); if (out instanceof Promise) out.then(done, e => console.log('optional', "rejected", String(e))); else done(out); } catch (e) { console.log('optional', "threw", e.name); }
}
class Cell120 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell120(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('comma', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('comma', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (0, c))(c); if (out instanceof Promise) out.then(done, e => console.log('comma', "rejected", String(e))); else done(out); } catch (e) { console.log('comma', "threw", e.name); }
}
class Cell121 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell121(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('ternary', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('ternary', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (c.n ? c : null))(c); if (out instanceof Promise) out.then(done, e => console.log('ternary', "rejected", String(e))); else done(out); } catch (e) { console.log('ternary', "threw", e.name); }
}
class Cell122 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell122(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('or', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('or', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => null || c)(c); if (out instanceof Promise) out.then(done, e => console.log('or', "rejected", String(e))); else done(out); } catch (e) { console.log('or', "threw", e.name); }
}
class Cell123 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell123(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('nullish', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('nullish', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => null ?? c)(c); if (out instanceof Promise) out.then(done, e => console.log('nullish', "rejected", String(e))); else done(out); } catch (e) { console.log('nullish', "threw", e.name); }
}
class Cell124 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell124(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('and', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('and', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => 1 && c)(c); if (out instanceof Promise) out.then(done, e => console.log('and', "rejected", String(e))); else done(out); } catch (e) { console.log('and', "threw", e.name); }
}
