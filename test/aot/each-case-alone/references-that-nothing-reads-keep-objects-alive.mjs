// An object that a live object refers to is alive, also when no code ever reads the reference. Each case makes 500 objects whose only strong reference is one that nothing reads, collects, and counts the survivors. An executable has no property of a class or of a literal that nothing reads, so no case here holds its object by one.
const N = 500;
async function collect() { for (let i = 0; i < 4; i++) { await new Promise(done => setTimeout(done, 1)); Bun.gc(true); } }
async function t(name, make) { const holders = [], weak = []; for (let i = 0; i < N; i++) { const [h, w] = make(i); holders.push(h); weak.push(w); } await collect(); let alive = 0; for (const w of weak) if (w.deref() !== undefined) alive++; console.log(name, alive, holders.length); }
await t("private field", i => { class Holder { #keep; constructor(o) { this.#keep = o; } } const o = { i }; return [new Holder(o), new WeakRef(o)]; });
await t("property added", i => { const o = { i }, h = {}; h.keep = o; return [h, new WeakRef(o)]; });
await t("constructor function", i => { function Holder(o) { this.keep = o; } const o = { i }; return [new Holder(o), new WeakRef(o)]; });
await t("array element", i => { const o = { i }; return [[o], new WeakRef(o)]; });
await t("array push", i => { const o = { i }, h = []; h.push(o); return [h, new WeakRef(o)]; });
await t("list in a field", i => { class Holder { list = []; add(o) { this.list.push(o); } } const o = { i }, h = new Holder(); h.add(o); return [h, new WeakRef(o)]; });
await t("map value", i => { const o = { i }; return [new Map([[i, o]]), new WeakRef(o)]; });
await t("map key", i => { const o = { i }, m = new Map(); m.set(o, i); return [m, new WeakRef(o)]; });
await t("set member", i => { const o = { i }, s = new Set(); s.add(o); return [s, new WeakRef(o)]; });
await t("map in a field", i => { class Holder { byId = new Map(); add(o) { this.byId.set(o.i, o); } } const o = { i }, h = new Holder(); h.add(o); return [h, new WeakRef(o)]; });
await t("symbol key", i => { const k = Symbol("keep"), o = { i }; return [{ [k]: o }, new WeakRef(o)]; });
await t("accessor closure", i => { const o = { i }; return [{ get never() { return o; } }, new WeakRef(o)]; });
await t("closure that reads it", i => { const o = { i }; return [() => o, new WeakRef(o)]; });
await t("bound argument", i => { const o = { i }; return [(function (x) {}).bind(null, o), new WeakRef(o)]; });
await t("bound this", i => { const o = { i }; return [(function () {}).bind(o), new WeakRef(o)]; });
await t("prototype", i => { const o = { i }; return [Object.create(o), new WeakRef(o)]; });
await t("resolved promise", i => { const o = { i }; return [Promise.resolve(o), new WeakRef(o)]; });
await t("suspended generator", i => { const o = { i }; function* g(x) { yield 1; return x; } const it = g(o); it.next(); return [it, new WeakRef(o)]; });
await t("suspended async function", i => { const o = { i }; const never = new Promise(() => {}); const p = (async x => { await never; return x; })(o); return [[p, never], new WeakRef(o)]; });
await t("weak map value", i => { const o = { i }, k = {}, m = new WeakMap([[k, o]]); return [[k, m], new WeakRef(o)]; });
await t("error cause", i => { const o = { i }; return [new Error("e", { cause: o }), new WeakRef(o)]; });
await t("static field", i => { const o = { i }; return [class { static keep = o; }, new WeakRef(o)]; });
await t("object assign", i => { const o = { i }; return [Object.assign({}, { keep: o }), new WeakRef(o)]; });
await t("define property", i => { const o = { i }; return [Object.defineProperty({}, "keep", { value: o }), new WeakRef(o)]; });
