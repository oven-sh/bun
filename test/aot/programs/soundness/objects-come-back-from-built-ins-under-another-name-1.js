// An object goes into a built-in and comes out under another name: a store through that name is seen by reads through the first. Each case has a class, an allocation and a store of its own.
const id = x => x;
class Cell0 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell0(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('array literal', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array literal', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c][0])(c); if (out instanceof Promise) out.then(done, e => console.log('array literal', "rejected", String(e))); else done(out); } catch (e) { console.log('array literal', "threw", e.name); }
}
class Cell1 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell1(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('array at', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array at', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].at(-1))(c); if (out instanceof Promise) out.then(done, e => console.log('array at', "rejected", String(e))); else done(out); } catch (e) { console.log('array at', "threw", e.name); }
}
class Cell2 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell2(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('array pop', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array pop', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].pop())(c); if (out instanceof Promise) out.then(done, e => console.log('array pop', "rejected", String(e))); else done(out); } catch (e) { console.log('array pop', "threw", e.name); }
}
class Cell3 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell3(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('array shift', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array shift', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].shift())(c); if (out instanceof Promise) out.then(done, e => console.log('array shift', "rejected", String(e))); else done(out); } catch (e) { console.log('array shift', "threw", e.name); }
}
class Cell4 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell4(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('array push', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array push', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const a = []; a.push(c); return a[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('array push', "rejected", String(e))); else done(out); } catch (e) { console.log('array push', "threw", e.name); }
}
class Cell5 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell5(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('array unshift', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('array unshift', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const a = []; a.unshift(c); return a[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('array unshift', "rejected", String(e))); else done(out); } catch (e) { console.log('array unshift', "threw", e.name); }
}
class Cell6 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell6(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('splice out', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('splice out', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].splice(0, 1)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('splice out', "rejected", String(e))); else done(out); } catch (e) { console.log('splice out', "threw", e.name); }
}
class Cell7 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell7(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('splice in', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('splice in', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const a = [0]; a.splice(0, 1, c); return a[0]; })(c); if (out instanceof Promise) out.then(done, e => console.log('splice in', "rejected", String(e))); else done(out); } catch (e) { console.log('splice in', "threw", e.name); }
}
class Cell8 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell8(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('slice', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('slice', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].slice()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('slice', "rejected", String(e))); else done(out); } catch (e) { console.log('slice', "threw", e.name); }
}
class Cell9 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell9(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('concat', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('concat', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [].concat([c])[0])(c); if (out instanceof Promise) out.then(done, e => console.log('concat', "rejected", String(e))); else done(out); } catch (e) { console.log('concat', "threw", e.name); }
}
class Cell10 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell10(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('concat value', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('concat value', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [].concat(c)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('concat value', "rejected", String(e))); else done(out); } catch (e) { console.log('concat value', "threw", e.name); }
}
class Cell11 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell11(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('flat', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('flat', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [[c]].flat()[0])(c); if (out instanceof Promise) out.then(done, e => console.log('flat', "rejected", String(e))); else done(out); } catch (e) { console.log('flat', "threw", e.name); }
}
class Cell12 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell12(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('flatMap', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('flatMap', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [0].flatMap(() => [c])[0])(c); if (out instanceof Promise) out.then(done, e => console.log('flatMap', "rejected", String(e))); else done(out); } catch (e) { console.log('flatMap', "threw", e.name); }
}
class Cell13 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell13(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('map', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('map', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].map(id)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('map', "rejected", String(e))); else done(out); } catch (e) { console.log('map', "threw", e.name); }
}
class Cell14 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell14(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('filter', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('filter', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].filter(() => true)[0])(c); if (out instanceof Promise) out.then(done, e => console.log('filter', "rejected", String(e))); else done(out); } catch (e) { console.log('filter', "threw", e.name); }
}
class Cell15 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell15(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('find', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('find', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].find(() => true))(c); if (out instanceof Promise) out.then(done, e => console.log('find', "rejected", String(e))); else done(out); } catch (e) { console.log('find', "threw", e.name); }
}
class Cell16 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell16(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('findLast', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('findLast', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].findLast(() => true))(c); if (out instanceof Promise) out.then(done, e => console.log('findLast', "rejected", String(e))); else done(out); } catch (e) { console.log('findLast', "threw", e.name); }
}
class Cell17 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell17(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('reduce', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('reduce', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].reduce((a, b) => b, null))(c); if (out instanceof Promise) out.then(done, e => console.log('reduce', "rejected", String(e))); else done(out); } catch (e) { console.log('reduce', "threw", e.name); }
}
class Cell18 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell18(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('reduce seed', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('reduce seed', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [0].reduce(a => a, c))(c); if (out instanceof Promise) out.then(done, e => console.log('reduce seed', "rejected", String(e))); else done(out); } catch (e) { console.log('reduce seed', "threw", e.name); }
}
class Cell19 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell19(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('reduceRight', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('reduceRight', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c].reduceRight((a, b) => b, null))(c); if (out instanceof Promise) out.then(done, e => console.log('reduceRight', "rejected", String(e))); else done(out); } catch (e) { console.log('reduceRight', "threw", e.name); }
}
class Cell20 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell20(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('forEach', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('forEach', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; [c].forEach(v => { r = v; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('forEach', "rejected", String(e))); else done(out); } catch (e) { console.log('forEach', "threw", e.name); }
}
class Cell21 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell21(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('forEach this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('forEach this', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; [0].forEach(function () { r = this; }, c); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('forEach this', "rejected", String(e))); else done(out); } catch (e) { console.log('forEach this', "threw", e.name); }
}
class Cell22 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell22(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('some', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('some', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; [c].some(v => (r = v, true)); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('some', "rejected", String(e))); else done(out); } catch (e) { console.log('some', "threw", e.name); }
}
class Cell23 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell23(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('every', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('every', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; [c].every(v => (r = v, true)); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('every', "rejected", String(e))); else done(out); } catch (e) { console.log('every', "threw", e.name); }
}
class Cell24 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell24(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('sort', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('sort', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [c, c].sort(() => 0)[1])(c); if (out instanceof Promise) out.then(done, e => console.log('sort', "rejected", String(e))); else done(out); } catch (e) { console.log('sort', "threw", e.name); }
}
