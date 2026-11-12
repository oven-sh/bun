"use strict";
const out = [];
function make(n) { const o = { n }; Object.defineProperties(o, { twice: { enumerable: true, get: function () { return this.n * 2; }, set: function (v) { this.n = v / 2; } }, kind: { enumerable: true, get() { return typeof this; } } }); return o; }
const o = make(4); let sum = 0; for (let i = 0; i < 50; i++) { o.twice = i; sum += o.twice; } out.push(sum);
out.push(JSON.stringify(o), JSON.stringify(Object.entries(o)), JSON.stringify(Object.assign({}, o)), JSON.stringify({ ...o }), JSON.stringify(structuredClone(o)));
out.push(Reflect.get(o, "twice", { n: "7" }), String(Reflect.get(o, "twice", 5)), Reflect.get(o, "kind", 5), Reflect.get(o, "kind", "s"), Reflect.set(o, "twice", 10, { n: 1 }), Reflect.set(o, "twice", 12, o), o.n);
const h = Object.create(o, { n: { value: 1.5, writable: true } }); out.push(h.twice, Object.create(h).twice); h.twice = 9; out.push(h.n, o.n);
const p = new Proxy(o, { get(t, k, r) { return Reflect.get(t, k, k === "twice" ? { n: 1n } : r); } }); try { out.push(String(p.twice)); } catch (e) { out.push(e.name); }
class K extends Object { constructor() { super(); Object.defineProperties(this, { v: { get: function () { return this === undefined ? "u" : this.constructor.name; } } }); } } out.push(new K().v, Object.create(new K()).v);
for (const k of Object.keys(o)) out.push(k, o[k]);
for (const k in o) out.push(o[k]);
const { twice, ...rest } = o; out.push(twice, JSON.stringify(rest));
out.push(...Object.values(o).map(String), [o, make(1)].map(x => x.twice).join(), [make(3), make(2)].sort((a, b) => a.twice - b.twice).map(x => x.n).join());
Promise.resolve({ __proto__: null }).then(() => { const t = {}; Object.defineProperties(t, { then: { get: function () { out.push("then " + (this === t)); return undefined; } } }); return t; }).then(() => console.log(out.join("|")));
