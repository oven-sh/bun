// The read in front is a guard, a bare mention, a choice, a switch; the copy stands alone, with a name behind it, in a method of a class, in a loop of unknown bound, behind an await, under try; two, three and four shapes; kinds of the field read.
const out = [];
class Store { items = []; add(item) { if (!item.id) throw new Error("no id"); this.items.push({ ...item }); return this.items.length; } }
function withMore(o) { if (!o.a) return; out.push({ ...o, extra: 1 }); }
function mentioned(o) { void o.a; out.push({ ...o }); }
function chosen(o) { out.push(o.a ? { ...o } : null); }
function switched(o) { switch (o.a) { case 0: return; default: out.push({ ...o }); } }
function looped(o, n) { let last; for (let i = 0; i < n; i++) { if (!o.a) break; last = { ...o }; } out.push(last, o.a); }
async function later(o) { if (!o.a) return; await null; out.push({ ...o }); }
function tried(o) { try { if (!o.a) throw 1; out.push({ ...o }); } catch { out.push("caught"); } }
function twice(o) { if (!o.a || !o.b) return; out.push({ ...o }, { ...o }); }
const store = new Store();
store.add({ id: 7 }); store.add({ id: "abc", owner: 3 }); store.add({ id: 1.5, owner: 3, more: true });
const shapes = () => [{ a: 1 }, { a: "x", b: 3 }, { a: 2.5, b: "y", c: null }, { a: true, d: [1] }, { b: 1, a: { deep: 1 } }, { a: 0, z: 1 }, { a: 10n }];
for (const f of [withMore, mentioned, chosen, switched, tried, twice]) for (const o of shapes()) f(o);
for (const n of [JSON.parse("0"), JSON.parse("2"), JSON.parse('""')]) for (const o of shapes()) looped(o, n);
Promise.all(shapes().map(later)).then(() => console.log(JSON.stringify(out, (k, v) => typeof v === "bigint" ? "big" + v : v === undefined ? "none" : v), JSON.stringify(store.items)));
