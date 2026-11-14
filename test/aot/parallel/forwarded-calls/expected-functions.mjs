// Functions that are expected to be one, called through call and apply in loops, and what else may come in their place.
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? JSON.stringify(r) : String(r).slice(0, 70)); };
const add = function (n) { return this.k + n; };
const times = function (n) { return this.k * n; };
const holder = { k: 3 };
const cases = {
  same: i => add, other: i => times, changing: i => (i < 100 ? add : times), alternating: i => (i & 1 ? add : times), arrow: i => n => n + 1, bound: i => add.bind({ k: 10 }), builtin: i => Math.max, proxy: i => new Proxy(add, { apply: (t, self, args) => t.apply(self, args) + 1000 }),
  generator: i => function* (n) { yield n; }, async: i => async function (n) { return n; }, klass: i => class { }, none: i => (i === 150 ? undefined : add), nothing: i => null, object: i => ({ call: (self, n) => n * 50, apply: (self, list) => list[0] * 60 }), ownCall: i => Object.assign(function (n) { return n; }, { call: (self, n) => n * 70, apply: (self, list) => list[0] * 80 }), method: i => ({ m(n) { return this.k - n; } }).m, strict: i => function (n) { "use strict"; return (this?.k ?? 90) + n; },
};
for (const [label, give] of Object.entries(cases)) {
  show(label + " call", () => { const wrap = f => function (n) { return f.call(this, n); }; let s = 0; for (let i = 0; i < 200; i++) { const g = wrap(give(i)); const r = g.call(holder, i & 3); s += typeof r === "number" ? r : 7; } return s; });
  show(label + " apply", () => { const wrap = f => function (...r) { return f.apply(this, r); }; let s = 0; for (let i = 0; i < 200; i++) { const g = wrap(give(i)); const r = g.call(holder, i & 3, 2); s += typeof r === "number" ? r : 7; } return s; });
  show(label + " arguments", () => { const wrap = f => function () { return f.apply(this, arguments); }; let s = 0; for (let i = 0; i < 200; i++) { const g = wrap(give(i)); const r = g.call(holder, i & 3, 2); s += typeof r === "number" ? r : 7; } return s; });
  show(label + " reflect", () => { const wrap = f => function (...r) { return Reflect.apply(f, this, r); }; let s = 0; for (let i = 0; i < 200; i++) { const g = wrap(give(i)); const r = g.call(holder, i & 3, 2); s += typeof r === "number" ? r : 7; } return s; });
}
{ let f = add; const go = n => f.call(holder, n); show("variable", () => { let s = 0; for (let i = 0; i < 300; i++) { if (i === 100) f = times; if (i === 200) f = n => n; s += go(i & 3); } return s; }); }
{ let f = null; f = add; const go = (...r) => f.apply(holder, r); show("list", () => { let s = 0; for (let i = 0; i < 300; i++) s += go(i & 3, 4, 5); return s; }); show("no list", () => { let s = 0; for (let i = 0; i < 300; i++) { const r = f.apply(holder); s += Number.isNaN(r) ? 1 : r; } return s; }); show("null list", () => { let s = 0; for (let i = 0; i < 300; i++) { const r = f.apply(holder, null); s += Number.isNaN(r) ? 1 : r; } return s; }); show("bad list", () => f.apply(holder, 5)); show("like a list", () => { let s = 0; for (let i = 0; i < 300; i++) s += f.apply(holder, { length: 1, 0: i & 3 }); return s; }); }
{ const f = process.argv.length > 99 ? times : add; show("receivers", () => { let s = 0; const os = [holder, { k: 5, z: 1 }, Object.create(holder), [], 7, "x", null, undefined]; for (let i = 0; i < 320; i++) { let r; try { r = f.call(os[i % os.length], 1); } catch (e) { r = 1000; } s += Number.isNaN(r) ? 1 : r; } return s; }); }
{ const deep = f => n => f.call(holder, n) + 1; const g = deep(deep(deep(function (n) { return n + this.k; }))); show("deep", () => { let s = 0; for (let i = 0; i < 300; i++) s += g(i & 3); return s; }); }
{ const count = function (n) { return n <= 0 ? 0 : 1 + count.call(this, n - 1); }; show("itself", () => { let s = 0; for (let i = 0; i < 100; i++) s += count.call(holder, i % 9); return s; }); }
