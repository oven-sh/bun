// An object goes into a built-in and comes out under another name: a store through that name is seen by reads through the first. Each case has a class, an allocation and a store of its own.
const id = x => x;
class Cell25 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell25(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('sort argument', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('sort argument', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; [c, c].sort(a => (r = a, 0)); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('sort argument', "rejected", String(e))); else done(out); } catch (e) { console.log('sort argument', "threw", e.name); }
}
class Cell26 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell26(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('toSorted', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toSorted', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].toSorted()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('toSorted', "rejected", String(e))); else done(out); } catch (e) { console.log('toSorted', "threw", e.name); }
}
class Cell27 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell27(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('toReversed', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toReversed', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].toReversed()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('toReversed', "rejected", String(e))); else done(out); } catch (e) { console.log('toReversed', "threw", e.name); }
}
class Cell28 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell28(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('toSpliced', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('toSpliced', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [0].toSpliced(0, 1, c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('toSpliced', "rejected", String(e))); else done(out); } catch (e) { console.log('toSpliced', "threw", e.name); }
}
class Cell29 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell29(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('with', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('with', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [0].with(0, c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('with', "rejected", String(e))); else done(out); } catch (e) { console.log('with', "threw", e.name); }
}
class Cell30 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell30(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('reverse', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('reverse', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].reverse()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('reverse', "rejected", String(e))); else done(out); } catch (e) { console.log('reverse', "threw", e.name); }
}
class Cell31 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell31(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('fill', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('fill', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Array(2).fill(c)[1])(c); if (out instanceof Promise) out.then(done, e => console.log('fill', "rejected", String(e))); else done(out); } catch (e) { console.log('fill', "threw", e.name); }
}
class Cell32 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell32(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('copyWithin', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('copyWithin', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c, 0].copyWithin(1, 0)[1])(c); if (out instanceof Promise) out.then(done, e => console.log('copyWithin', "rejected", String(e))); else done(out); } catch (e) { console.log('copyWithin', "threw", e.name); }
}
class Cell33 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell33(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Array.of', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array.of', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Array.of(c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array.of', "rejected", String(e))); else done(out); } catch (e) { console.log('Array.of', "threw", e.name); }
}
class Cell34 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell34(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Array.from', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array.from', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Array.from([c])[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array.from', "rejected", String(e))); else done(out); } catch (e) { console.log('Array.from', "threw", e.name); }
}
class Cell35 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell35(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Array.from map', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array.from map', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Array.from([0], () => c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array.from map', "rejected", String(e))); else done(out); } catch (e) { console.log('Array.from map', "threw", e.name); }
}
class Cell36 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell36(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Array.from like', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array.from like', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Array.from({ length: 1, 0: c })[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array.from like', "rejected", String(e))); else done(out); } catch (e) { console.log('Array.from like', "threw", e.name); }
}
class Cell37 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell37(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('new Array', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('new Array', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Array(c, c)[1])(c); if (out instanceof Promise) out.then(done, e => console.log('new Array', "rejected", String(e))); else done(out); } catch (e) { console.log('new Array', "threw", e.name); }
}
class Cell38 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell38(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Array call', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Array call', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Array(c, c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Array call', "rejected", String(e))); else done(out); } catch (e) { console.log('Array call', "threw", e.name); }
}
class Cell39 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell39(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('spread', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('spread', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [...[c]][0])(c); if (out instanceof Promise) out.then(done, e => console.log('spread', "rejected", String(e))); else done(out); } catch (e) { console.log('spread', "threw", e.name); }
}
class Cell40 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell40(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('spread call', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('spread call', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => id(...[c]))(c); if (out instanceof Promise) out.then(done, e => console.log('spread call', "rejected", String(e))); else done(out); } catch (e) { console.log('spread call', "threw", e.name); }
}
class Cell41 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell41(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('rest', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('rest', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => ((...r) => r[0])(c))(c); if (out instanceof Promise) out.then(done, e => console.log('rest', "rejected", String(e))); else done(out); } catch (e) { console.log('rest', "threw", e.name); }
}
class Cell42 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell42(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('arguments', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('arguments', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (function () { return arguments[0]; })(c))(c); if (out instanceof Promise) out.then(done, e => console.log('arguments', "rejected", String(e))); else done(out); } catch (e) { console.log('arguments', "threw", e.name); }
}
class Cell43 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell43(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('destructure', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('destructure', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const [a] = [c]; return a; })(c); if (out instanceof Promise) out.then(done, e => console.log('destructure', "rejected", String(e))); else done(out); } catch (e) { console.log('destructure', "threw", e.name); }
}
class Cell44 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell44(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('destructure rest', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('destructure rest', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const [, ...r] = [0, c]; return r[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('destructure rest', "rejected", String(e))); else done(out); } catch (e) { console.log('destructure rest', "threw", e.name); }
}
class Cell45 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell45(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('object rest', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('object rest', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const { a, ...r } = { a: 0, b: c }; return r.b; })(c); if (out instanceof Promise) out.then(done, e => console.log('object rest', "rejected", String(e))); else done(out); } catch (e) { console.log('object rest', "threw", e.name); }
}
class Cell46 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell46(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('values', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('values', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].values().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('values', "rejected", String(e))); else done(out); } catch (e) { console.log('values', "threw", e.name); }
}
class Cell47 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell47(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('entries', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('entries', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].entries().next().value[1])(c); if (out instanceof Promise) out.then(done, e => console.log('entries', "rejected", String(e))); else done(out); } catch (e) { console.log('entries', "threw", e.name); }
}
class Cell48 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell48(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('iterator', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('iterator', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c][Symbol.iterator]().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('iterator', "rejected", String(e))); else done(out); } catch (e) { console.log('iterator', "threw", e.name); }
}
class Cell49 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell49(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('for of', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('for of', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { for (const v of [c]) return v; })(c); if (out instanceof Promise) out.then(done, e => console.log('for of', "rejected", String(e))); else done(out); } catch (e) { console.log('for of', "threw", e.name); }
}
