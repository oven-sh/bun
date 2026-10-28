// An untyped function is used one way thousands of times, so that its use suggests types for its parameters and for what hangs below them. Then a value arrives that fits at the top and differs deeper down,
// or the objects it has already been given change. Nothing may throw that plain Bun does not throw, and every answer is plain Bun's.
const show = v => typeof v === "string" ? v : v === undefined || typeof v === "function" || typeof v === "symbol" || typeof v === "bigint" ? typeof v : JSON.stringify(v);
function t(name, f) { let r; try { r = show(f()); } catch (e) { r = "threw " + e.name; } console.log(name, r); }
function total(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i].size.w * 2; return sum; }
const row = w => ({ size: { w, h: 1 }, name: "r" });
const usual = () => [row(1), row(2), row(3)];
function warm() { let s = 0; for (let i = 0; i < 3000; i++) s += total(usual()); return s; }
t("the usual use", () => warm());
t("a text deep inside", () => { warm(); const rows = usual(); rows[1].size.w = "4"; return total(rows); });
t("undefined deep inside", () => { warm(); const rows = usual(); rows[1].size.w = undefined; return total(rows); });
t("a missing name deep inside", () => { warm(); const rows = usual(); delete rows[1].size.w; return total(rows); });
t("null in the middle", () => { warm(); const rows = usual(); rows[1].size = null; return total(rows); });
t("a number in the middle", () => { warm(); const rows = usual(); rows[1].size = 5; return total(rows); });
t("a big integer deep inside", () => { warm(); const rows = usual(); rows[2].size.w = 4n; return total(rows); });
t("an object with valueOf deep inside", () => { warm(); const log = []; const rows = usual(); rows[0].size.w = { valueOf() { log.push("asked"); return 10; } }; return [total(rows), log]; });
t("a getter deep inside", () => { warm(); let n = 0; const rows = usual(); Object.defineProperty(rows[1].size, "w", { get() { return ++n; } }); return [total(rows), total(rows), n]; });
t("a getter in the middle that changes the rows", () => { warm(); const rows = usual(); Object.defineProperty(rows[0], "size", { get() { rows.length = 1; return { w: 100 }; } }); return total(rows); });
t("another order of names", () => { warm(); return total([{ name: "r", size: { h: 1, w: 5 } }, { size: { w: 6 } }, { extra: 0, size: { a: 0, b: 0, w: 7 } }]); });
t("the name on the prototype", () => { warm(); class Size { } Size.prototype.w = 9; return total([{ size: new Size() }, { size: Object.create({ w: 1 }) }, Object.create({ size: { w: 2 } })]); });
t("instances of classes", () => { warm(); class Size { constructor(w) { this.w = w; } } class Row { constructor(w) { this.size = new Size(w); } } return total([new Row(1), new Row(2)]); });
t("a hole in the rows", () => { warm(); const rows = usual(); delete rows[1]; return total(rows); });
t("a number among the rows", () => { warm(); const rows = usual(); rows.push(5); return total(rows); });
t("rows that are no array", () => { warm(); return [total({ length: 2, 0: row(1), 1: row(2) }), total("ab".length ? { length: 0 } : []), total(new Array(0))]; });
t("rows that are a text", () => { warm(); return total("ab"); });
t("rows of a subclass with its own length", () => { warm(); class Rows extends Array { get length() { return 1; } } const r = new Rows(); r[0] = row(3); r[1] = row(4); return total(r); });
t("rows behind a proxy", () => { warm(); const log = []; const p = new Proxy(usual(), { get(target, key, receiver) { log.push(String(key)); return Reflect.get(target, key, receiver); } }); return [total(p), log.length]; });
t("frozen rows", () => { warm(); const rows = Object.freeze(usual().map(r => Object.freeze({ size: Object.freeze(r.size) }))); return total(rows); });
t("parsed rows, other order and more names", () => { warm(); const rows = JSON.parse('[{"name":"a","size":{"h":1,"w":2,"z":0}},{"size":{"w":3},"more":true}]'); return [total(rows), Object.keys(rows[0]), Object.keys(rows[0].size), Object.keys(rows[1])]; });
t("parsed rows with a name twice, proto and numbers as names", () => { warm(); const rows = JSON.parse('[{"size":{"w":1,"w":5,"__proto__":{"w":9},"2":0,"1":0}}]'); return [total(rows), Object.keys(rows[0].size), Object.getPrototypeOf(rows[0].size) === Object.prototype]; });
t("parsed rows that lack the name", () => { warm(); return total(JSON.parse('[{"size":{}},{"size":{"w":null}}]')); });
t("parsed text written again", () => { warm(); const text = '[{"name":"a","size":{"h":1,"w":2}},{"size":{"w":3,"h":4},"name":"b"}]'; const rows = JSON.parse(text); total(rows); return JSON.stringify(rows) === text; });
t("the change comes while the function runs", () => { warm(); const rows = usual(); rows[0].size = { get w() { rows[2].size.w = "30"; rows[1].size = { w: 20 }; return 1; } }; return total(rows); });
t("the change comes from another function between two calls", () => { warm(); const rows = usual(); const a = total(rows); const spoil = r => { r[0].size.w = "x"; }; spoil(rows); return [a, total(rows)]; });
t("a store of another kind in the warm function itself", () => { function grow(box, v) { box.v = v; return box.v; } const b = { v: 0 }; for (let i = 0; i < 3000; i++) grow(b, i); return [grow(b, "text"), grow(b, null), grow(b, { deep: 1 }), grow(b, 1.5), typeof b.v]; });
t("a result of another kind", () => { function pick(o) { return o.v; } for (let i = 0; i < 3000; i++) pick({ v: i }); return [pick({ v: "s" }) + 1, pick({}) === undefined, pick({ v: null }), pick({ get v() { return 7; } })]; });
t("this of another kind", () => { function width() { return this.size.w; } const o = { size: { w: 1 }, width }; for (let i = 0; i < 3000; i++) o.width(); return [width.call({ size: { w: "s" } }), width.call({ size: 5 }), (() => { try { return width.call(undefined); } catch (e) { return e.name; } })()]; });
t("fewer and more arguments", () => { function add(a, b) { return a.n + b.n; } for (let i = 0; i < 3000; i++) add({ n: 1 }, { n: 2 }); return [(() => { try { return add({ n: 1 }); } catch (e) { return e.name; } })(), add({ n: 1 }, { n: 2 }, { n: 3 }), add({ n: "a" }, { n: 2 })]; });
