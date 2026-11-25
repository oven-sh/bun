// STATISTIC: ListedValuesStoredByName >= 3
// `const names = Object.keys(o)`: an element of a list that is only read is one of the names.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
const describe = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? "{}" : String(v);
class Point { constructor(x, y) { this.x = x; this.y = y; this.next = null; } sum() { return this.x + this.y; } step(k) { this.x = (this.x + k) & 1023; if (this.next) this.y = this.next.y; return this; } }
function Old(x, y) { this.x = x; this.y = y; this.next = null; }
Old.prototype.sum = function () { return this.x + this.y; };
Old.prototype.step = function (k) { this.x = (this.x + k) & 1023; if (this.next) this.y = this.next.y; return this; };
function hot(n, make, C) { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const p = make(new C(i, i + 1), new C(0, 0)); p.next = i ? list[i - 1] : null; list.push(p); } for (let k = 0; k < n; k++) { const p = list[k & 7]; total = (total + p.step(k).sum()) | 0; } return total; }
const copies = {
  counted(o, r) { const names = Object.keys(o); for (let i = 0; i < names.length; i++) r[names[i]] = o[names[i]]; return r; },
  named(o, r) { var names = Object.keys(o); for (var i = 0; i < names.length; i++) { var k = names[i]; r[k] = o[k]; } return r; },
  back(o, r) { const names = Object.keys(o); let i = names.length; while (i--) { const k = names[i]; r[k] = o[k]; } return r; },
  kept(o, r) { const names = Object.keys(o); if (names.length > 99) return r; for (const k of names) r[k] = o[k]; return r; },
  each(o, r) { const names = Object.keys(o); names.forEach((k) => { r[k] = o[k]; }); return names.length ? r : null; },
  mapped(o, r) { Object.keys(o).map((k) => { r[k] = o[k]; return k; }); return r; },
  filtered(o, r) { Object.keys(o).filter((k) => k !== "zzz").forEach((k) => { r[k] = o[k]; }); return r; },
};
for (const name of Object.keys(copies)) {
  const make = copies[name];
  tell(name, () => [hot(500, make, Point), hot(500, make, Old)]);
  tell(name + " late", () => { const o = new Point(1, "t"); o.late = [1]; const r = make(o, new Point(0, 0)); const s = make(new Old(1.5, 2), new Old(0, 0)); return [Object.entries(r).map(([k, v]) => k + describe(v)), r.sum(), s.sum(), Object.keys(s)]; });
}
class Told { constructor(a) { this.a = a; this.b = "b"; } kind() { return "told"; } }
tell("added name", () => { const o = new Told(1), r = new Told(2), names = Object.keys(o); names.push("kind"); for (let i = 0; i < names.length; i++) r[names[i]] = o[names[i]]; return [Object.keys(r), r.kind()]; });
tell("written name", () => { const o = new Told(1), r = new Told(2), names = Object.keys(o); names[1] = "kind"; for (let i = 0; i < names.length; i++) r[names[i]] = o[names[i]]; return [Object.keys(r), r.kind()]; });
const change = (list) => { list[0] = "kind"; return list; };
tell("passed on", () => { const o = new Told(1), r = new Told(2), names = Object.keys(o); change(names); for (let i = 0; i < names.length; i++) r[names[i]] = o[names[i]]; return Object.keys(r); });
tell("sorted", () => { const o = new Told(1), r = new Told(2), names = Object.keys(o); names.sort(); for (let i = 0; i < names.length; i++) r[names[i]] = o[names[i]]; return [Object.keys(r), r.a]; });
tell("past the end", () => { const o = new Told(1), r = new Told(2), names = Object.keys(o); for (let i = 0; i <= names.length; i++) r[names[i]] = o[names[i]]; return Object.entries(r); });
tell("deleted", () => { const o = new Told(1), r = new Told(2), names = Object.keys(o); delete o.b; for (let i = 0; i < names.length; i++) r[names[i]] = o[names[i]]; return [r, describe(r.b), Object.keys(r)]; });
tell("two lists", () => { const o = new Told(1), p = new Point(3, 4), r = new Told(2), names = Object.keys(o), others = Object.keys(p); for (let i = 0; i < names.length; i++) r[others[i]] = o[names[i]]; return Object.entries(r); });
tell("other index", () => { const o = new Told(1), r = new Told(2), names = Object.keys(o); for (let i = 0; i + 1 < names.length; i++) r[names[i]] = o[names[i + 1]]; return Object.entries(r); });
tell("equal", () => { const equal = (x, y) => { const kx = Object.keys(x); return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k]); }; return [equal(new Told(1), new Told(1)), equal(new Told(1), new Told(2)), equal(new Told(1), new Point(1, "b"))]; });
tell("some", () => { const o = new Told(5); return [Object.keys(o).some((k) => o[k] === 5), Object.keys(o).find((k) => o[k] === "b"), Object.keys(o).findIndex((k) => o[k] === "c"), Object.keys(o).filter((k) => typeof o[k] === "number")]; });
tell("read of another", () => { const o = new Told(1), p = { a: "pa", b: [1], kind: "pk" }; let text = ""; for (const k of Object.keys(o)) text += k + describe(p[k]); for (const k in o) text += describe(p[k]); return text; });
tell("with the list", () => { const o = new Told(1), r = new Told(2); Object.keys(o).forEach((k, i, list) => { list[1] = "kind"; r[k] = o[k]; }); return [Object.keys(r), r.kind()]; });
function Grown(a) { this.a = a; }
Grown.prototype.m = function () { return "m"; };
tell("function's own", () => { const o = new Grown(3), r = new Grown(4), names = Object.keys(o); for (let i = 0; i < names.length; i++) r[names[i]] = o[names[i]]; return [Object.keys(r), r.m(), r.a + 1]; });
class Count { constructor(a) { this.a = a; this.n = 1; } sum() { return this.a + this.n; } step(k) { this.n = (this.n + k) & 255; return this; } }
function marked(change) { const o = { a: 5 }, list = []; for (let i = 0; i < 4; i++) list.push(new Count(i)); let total = 0; for (let k = 0; k < 40; k++) total = (total + list[k & 3].step(k).sum()) | 0; const r = new Count(7), names = Object.keys(o); change(names); for (let i = 0; i < names.length; i++) r[names[i]] = "t"; return [total, r.sum(), r.n]; }
tell("another name added", () => marked((list) => { list.push("n"); }));
class Pair { constructor(a) { this.a = a; this.n = 1; } sum() { return this.a + this.n; } step(k) { this.n = (this.n + k) & 255; return this; } }
tell("another name written", () => { const o = { a: 5 }, list = []; for (let i = 0; i < 4; i++) list.push(new Pair(i)); let total = 0; for (let k = 0; k < 40; k++) total = (total + list[k & 3].step(k).sum()) | 0; const r = new Pair(7), names = Object.keys(o); names[0] = "n"; for (let i = 0; i < names.length; i++) r[names[i]] = "t"; return [total, r.sum(), r.n]; });
class Seen { constructor(a) { this.a = a; this.n = 1; } sum() { return this.a + this.n; } step(k) { this.n = (this.n + k) & 255; return this; } }
tell("another name by a callback", () => { const o = { a: 5 }, list = []; for (let i = 0; i < 4; i++) list.push(new Seen(i)); let total = 0; for (let k = 0; k < 40; k++) total = (total + list[k & 3].step(k).sum()) | 0; const r = new Seen(7); Object.keys(o).map((k, i, names) => { if (!i) names.push("n"); r[k] = "t"; }); const s = new Seen(8), kept = Object.keys(o); kept.splice(0, 1, "n"); kept.forEach((k) => { s[k] = "u"; }); return [total, r.sum(), s.sum()]; });
for (const line of out) console.log(line);
