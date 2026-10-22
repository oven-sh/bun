// An object goes into a built-in and comes out under another name: a store through that name is seen by reads through the first. Each case has a class, an allocation and a store of its own.
const id = x => x;
class Cell75 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell75(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('freeze', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('freeze', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.isFrozen(c) ? null : Object.preventExtensions({ k: c }).k)(c); if (out instanceof Promise) out.then(done, e => console.log('freeze', "rejected", String(e))); else done(out); } catch (e) { console.log('freeze', "threw", e.name); }
}
class Cell76 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell76(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Object()', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Object()', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object(c))(c); if (out instanceof Promise) out.then(done, e => console.log('Object()', "rejected", String(e))); else done(out); } catch (e) { console.log('Object()', "threw", e.name); }
}
class Cell77 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell77(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('new Object', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('new Object', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Object(c))(c); if (out instanceof Promise) out.then(done, e => console.log('new Object', "rejected", String(e))); else done(out); } catch (e) { console.log('new Object', "threw", e.name); }
}
class Cell78 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell78(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('valueOf', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('valueOf', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => c.valueOf())(c); if (out instanceof Promise) out.then(done, e => console.log('valueOf', "rejected", String(e))); else done(out); } catch (e) { console.log('valueOf', "threw", e.name); }
}
class Cell79 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell79(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('groupBy', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('groupBy', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Object.groupBy([c], () => "k").k[0])(c); if (out instanceof Promise) out.then(done, e => console.log('groupBy', "rejected", String(e))); else done(out); } catch (e) { console.log('groupBy', "threw", e.name); }
}
class Cell80 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell80(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Map.groupBy', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map.groupBy', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Map.groupBy([c], () => "k").get("k")[0])(c); if (out instanceof Promise) out.then(done, e => console.log('Map.groupBy', "rejected", String(e))); else done(out); } catch (e) { console.log('Map.groupBy', "threw", e.name); }
}
class Cell81 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell81(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Reflect.get', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.get', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Reflect.get({ k: c }, "k"))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.get', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.get', "threw", e.name); }
}
class Cell82 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell82(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Reflect.set', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.set', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { const o = {}; Reflect.set(o, "k", c); return o.k; })(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.set', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.set', "threw", e.name); }
}
class Cell83 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell83(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Reflect.get receiver', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.get receiver', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Reflect.get({ get k() { return this; } }, "k", c))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.get receiver', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.get receiver', "threw", e.name); }
}
class Cell84 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell84(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Reflect.apply', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.apply', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Reflect.apply(id, null, [c]))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.apply', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.apply', "threw", e.name); }
}
class Cell85 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell85(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Reflect.apply this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.apply this', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Reflect.apply(function () { return this; }, c, []))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.apply this', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.apply this', "threw", e.name); }
}
class Cell86 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell86(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Reflect.construct', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.construct', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Reflect.construct(function (v) { this.v = v; }, [c]).v)(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.construct', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.construct', "threw", e.name); }
}
class Cell87 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell87(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Reflect.getPrototypeOf', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect.getPrototypeOf', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Reflect.getPrototypeOf(Object.create(c)))(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect.getPrototypeOf', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect.getPrototypeOf', "threw", e.name); }
}
class Cell88 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell88(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Reflect descriptor', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Reflect descriptor', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => Reflect.getOwnPropertyDescriptor({ k: c }, "k").value)(c); if (out instanceof Promise) out.then(done, e => console.log('Reflect descriptor', "rejected", String(e))); else done(out); } catch (e) { console.log('Reflect descriptor', "threw", e.name); }
}
class Cell89 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell89(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('call', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('call', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => id.call(null, c))(c); if (out instanceof Promise) out.then(done, e => console.log('call', "rejected", String(e))); else done(out); } catch (e) { console.log('call', "threw", e.name); }
}
class Cell90 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell90(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('call this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('call this', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (function () { return this; }).call(c))(c); if (out instanceof Promise) out.then(done, e => console.log('call this', "rejected", String(e))); else done(out); } catch (e) { console.log('call this', "threw", e.name); }
}
class Cell91 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell91(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('apply', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('apply', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => id.apply(null, [c]))(c); if (out instanceof Promise) out.then(done, e => console.log('apply', "rejected", String(e))); else done(out); } catch (e) { console.log('apply', "threw", e.name); }
}
class Cell92 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell92(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('bind', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('bind', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => id.bind(null, c)())(c); if (out instanceof Promise) out.then(done, e => console.log('bind', "rejected", String(e))); else done(out); } catch (e) { console.log('bind', "threw", e.name); }
}
class Cell93 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell93(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('bind this', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('bind this', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (function () { return this; }).bind(c)())(c); if (out instanceof Promise) out.then(done, e => console.log('bind this', "rejected", String(e))); else done(out); } catch (e) { console.log('bind this', "threw", e.name); }
}
class Cell94 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell94(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Map', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Map([["k", c]]).get("k"))(c); if (out instanceof Promise) out.then(done, e => console.log('Map', "rejected", String(e))); else done(out); } catch (e) { console.log('Map', "threw", e.name); }
}
class Cell95 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell95(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Map set', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map set', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Map().set("k", c).get("k"))(c); if (out instanceof Promise) out.then(done, e => console.log('Map set', "rejected", String(e))); else done(out); } catch (e) { console.log('Map set', "threw", e.name); }
}
class Cell96 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell96(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Map key', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map key', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => new Map([[c, 1]]).keys().next().value)(c); if (out instanceof Promise) out.then(done, e => console.log('Map key', "rejected", String(e))); else done(out); } catch (e) { console.log('Map key', "threw", e.name); }
}
class Cell97 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell97(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Map values', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map values', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [...new Map([["k", c]]).values()][0])(c); if (out instanceof Promise) out.then(done, e => console.log('Map values', "rejected", String(e))); else done(out); } catch (e) { console.log('Map values', "threw", e.name); }
}
class Cell98 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell98(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Map entries', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map entries', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => [...new Map([["k", c]])][0][1])(c); if (out instanceof Promise) out.then(done, e => console.log('Map entries', "rejected", String(e))); else done(out); } catch (e) { console.log('Map entries', "threw", e.name); }
}
class Cell99 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell99(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('Map forEach', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('Map forEach', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => { let r; new Map([["k", c]]).forEach(v => { r = v; }); return r; })(c); if (out instanceof Promise) out.then(done, e => console.log('Map forEach', "rejected", String(e))); else done(out); } catch (e) { console.log('Map forEach', "threw", e.name); }
}
