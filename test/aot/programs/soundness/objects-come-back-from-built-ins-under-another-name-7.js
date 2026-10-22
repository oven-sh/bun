// An object goes into a built-in and comes out under another name: a store through that name is seen by reads through the first. Each case has a class, an allocation and a store of its own.
const id = x => x;
class Cell150 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell150(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('then', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('then', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.resolve(0).then(() => c))(c); if (out instanceof Promise) out.then(done, e => console.log('then', "rejected", String(e))); else done(out); } catch (e) { console.log('then', "threw", e.name); }
}
class Cell151 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell151(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('catch', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('catch', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.reject(c).catch(id))(c); if (out instanceof Promise) out.then(done, e => console.log('catch', "rejected", String(e))); else done(out); } catch (e) { console.log('catch', "threw", e.name); }
}
class Cell152 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell152(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('finally', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('finally', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.resolve(c).finally(() => 0))(c); if (out instanceof Promise) out.then(done, e => console.log('finally', "rejected", String(e))); else done(out); } catch (e) { console.log('finally', "threw", e.name); }
}
class Cell153 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell153(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('new Promise', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('new Promise', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Promise(r => r(c)))(c); if (out instanceof Promise) out.then(done, e => console.log('new Promise', "rejected", String(e))); else done(out); } catch (e) { console.log('new Promise', "threw", e.name); }
}
class Cell154 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell154(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('withResolvers', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('withResolvers', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const w = Promise.withResolvers(); w.resolve(c); return w.promise; })(c); if (out instanceof Promise) out.then(done, e => console.log('withResolvers', "rejected", String(e))); else done(out); } catch (e) { console.log('withResolvers', "threw", e.name); }
}
class Cell155 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell155(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('thenable', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('thenable', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.resolve({ then(r) { r(c); } }))(c); if (out instanceof Promise) out.then(done, e => console.log('thenable', "rejected", String(e))); else done(out); } catch (e) { console.log('thenable', "threw", e.name); }
}
class Cell156 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell156(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('all', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('all', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.all([c]).then(a => a[0]))(c); if (out instanceof Promise) out.then(done, e => console.log('all', "rejected", String(e))); else done(out); } catch (e) { console.log('all', "threw", e.name); }
}
class Cell157 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell157(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('allSettled', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('allSettled', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.allSettled([c]).then(a => a[0].value))(c); if (out instanceof Promise) out.then(done, e => console.log('allSettled', "rejected", String(e))); else done(out); } catch (e) { console.log('allSettled', "threw", e.name); }
}
class Cell158 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell158(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('race', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('race', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.race([c]))(c); if (out instanceof Promise) out.then(done, e => console.log('race', "rejected", String(e))); else done(out); } catch (e) { console.log('race', "threw", e.name); }
}
class Cell159 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell159(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('any', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('any', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.any([c]))(c); if (out instanceof Promise) out.then(done, e => console.log('any', "rejected", String(e))); else done(out); } catch (e) { console.log('any', "threw", e.name); }
}
class Cell160 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell160(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('any errors', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('any errors', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Promise.any([Promise.reject(c)]).catch(e => e.errors[0]))(c); if (out instanceof Promise) out.then(done, e => console.log('any errors', "rejected", String(e))); else done(out); } catch (e) { console.log('any errors', "threw", e.name); }
}
class Cell161 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell161(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('await', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('await', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (async c => await c)(c); if (out instanceof Promise) out.then(done, e => console.log('await', "rejected", String(e))); else done(out); } catch (e) { console.log('await', "threw", e.name); }
}
class Cell162 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell162(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('async return', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('async return', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (async c => c)(c); if (out instanceof Promise) out.then(done, e => console.log('async return', "rejected", String(e))); else done(out); } catch (e) { console.log('async return', "threw", e.name); }
}
class Cell163 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell163(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('await thenable', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('await thenable', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (async c => await { then(r) { r(c); } })(c); if (out instanceof Promise) out.then(done, e => console.log('await thenable', "rejected", String(e))); else done(out); } catch (e) { console.log('await thenable', "threw", e.name); }
}
class Cell164 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell164(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('async throw', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('async throw', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (async c => { try { await Promise.reject(c); } catch (e) { return e; } })(c); if (out instanceof Promise) out.then(done, e => console.log('async throw', "rejected", String(e))); else done(out); } catch (e) { console.log('async throw', "threw", e.name); }
}
class Cell165 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell165(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('async generator', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('async generator', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (async c => (await (async function* () { yield c; })().next()).value)(c); if (out instanceof Promise) out.then(done, e => console.log('async generator', "rejected", String(e))); else done(out); } catch (e) { console.log('async generator', "threw", e.name); }
}
class Cell166 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell166(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('for await', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('for await', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (async c => { for await (const v of [c]) return v; })(c); if (out instanceof Promise) out.then(done, e => console.log('for await', "rejected", String(e))); else done(out); } catch (e) { console.log('for await', "threw", e.name); }
}
class Cell167 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell167(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('fromAsync', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('fromAsync', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Array.fromAsync([c]).then(a => a[0]))(c); if (out instanceof Promise) out.then(done, e => console.log('fromAsync', "rejected", String(e))); else done(out); } catch (e) { console.log('fromAsync', "threw", e.name); }
}
class Cell168 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell168(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('timeout', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('timeout', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Promise(r => setTimeout(r, 0, c)))(c); if (out instanceof Promise) out.then(done, e => console.log('timeout', "rejected", String(e))); else done(out); } catch (e) { console.log('timeout', "threw", e.name); }
}
class Cell169 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell169(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('immediate', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('immediate', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Promise(r => setImmediate(r, c)))(c); if (out instanceof Promise) out.then(done, e => console.log('immediate', "rejected", String(e))); else done(out); } catch (e) { console.log('immediate', "threw", e.name); }
}
class Cell170 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell170(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('nextTick', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('nextTick', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Promise(r => process.nextTick(r, c)))(c); if (out instanceof Promise) out.then(done, e => console.log('nextTick', "rejected", String(e))); else done(out); } catch (e) { console.log('nextTick', "threw", e.name); }
}
class Cell171 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell171(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('microtask', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('microtask', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Promise(r => queueMicrotask(() => r(c))))(c); if (out instanceof Promise) out.then(done, e => console.log('microtask', "rejected", String(e))); else done(out); } catch (e) { console.log('microtask', "threw", e.name); }
}
class Cell172 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell172(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('promisify', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('promisify', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => require("node:util").promisify(cb => cb(null, c))())(c); if (out instanceof Promise) out.then(done, e => console.log('promisify', "rejected", String(e))); else done(out); } catch (e) { console.log('promisify', "threw", e.name); }
}
class Cell173 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell173(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('once', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('once', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const E = require("node:events"); const e = new E(); const p = E.once(e, "e").then(a => a[0]); e.emit("e", c); return p; })(c); if (out instanceof Promise) out.then(done, e => console.log('once', "rejected", String(e))); else done(out); } catch (e) { console.log('once', "threw", e.name); }
}
class Cell174 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell174(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Bun.peek', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Bun.peek', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Bun.peek(Promise.resolve(c)))(c); if (out instanceof Promise) out.then(done, e => console.log('Bun.peek', "rejected", String(e))); else done(out); } catch (e) { console.log('Bun.peek', "threw", e.name); }
}
