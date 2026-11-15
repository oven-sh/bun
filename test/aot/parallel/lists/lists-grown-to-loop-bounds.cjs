// Loops with constant bounds fill lists under their counter: in fields, with arms, with lists that others change meanwhile, and that take no elements.
const show = a => a.length + ":" + Array.from({ length: Math.min(a.length, 40) }, (x, i) => i in a ? String(a[i]) : "_").join() + ";" + String(a[a.length - 1]) + ";" + Object.keys(a).length;
const attempt = f => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
globalThis.change = null; const changes = (0, eval)("(function (list, i) { return globalThis.change ? globalThis.change(list, i) : 0; })");
function Table(wide, list) { this.readers = list || []; this.wide = wide; }
Table.prototype.read = function () { return 1; }; Table.prototype.skip = function () { return 2; };
Table.prototype.fill = function () { for (var i = 0; i <= 0x3FFF; i++) { if (i < 0x1000) this.readers[i] = this.read; else if (this.wide) this.readers[i] = i; else this.readers[i] = i / 2; } return this.readers; };
Table.prototype.part = function (end) { for (var i = 0; i < 5000; i++) { if (i === end) break; this.readers[i] = i; if (i === 20) changes(this.readers, i); } return this.readers; };
Table.prototype.steps = function () { for (let i = 0; i < 300; i++) { if (i % 3 === 1) continue; this.readers[i] = this.wide ? "s" + i : i * 0.5; } return this.readers; };
for (const wide of [false, true, "yes"]) { const a = new Table(wide).fill(); console.log(a.length, a[0] === a[100], a[0x1001], a[0x3FFF], a[0x4000], a.indexOf(undefined)); }
for (const end of [0, 1, 7, 21, 22, 64, 1000, 5000, -1]) console.log(show(new Table(true).part(end)));
const acts = { shorter: l => { l.length = 3; }, frozen: l => { Object.freeze(l); }, pushed: l => { l.push("p", "q"); }, popped: l => { l.pop(); l.pop(); }, holes: l => { delete l[2]; }, ahead: l => { l[l.length + 4] = "far"; }, getter: l => { Object.defineProperty(l, 30, { get() { return "g"; }, set(v) {}, configurable: true }); }, reversed: l => { l.reverse(); }, sealed: l => { Object.preventExtensions(l); }, sorted: l => { l.sort(); }, unshifted: l => { l.unshift("u"); } };
for (const name in acts) { globalThis.change = acts[name]; const table = new Table(true); console.log(name, attempt(() => show(table.part(100))), show(table.readers)); globalThis.change = null; }
class Own extends Array {}
const lists = [() => [1, 2, 3], () => [0.5], () => ["a"], () => new Array(10), () => new Array(6000), () => [, 1], () => Object.freeze([1]), () => Object.seal([1, 2]), () => new Own(), () => { const a = []; a[4000] = 1; return a; }, () => { const a = []; a.extra = 1; return a; }, () => { const a = [1, 2, 3]; a.length = 0; return a; }, () => { const a = [1, 2, 3]; a.shift(); return a; }, () => { const a = []; Object.defineProperty(a, "length", { writable: false }); return a; }, () => "a,b".split(",")];
for (const make of lists) { for (const wide of [true, false]) console.log(attempt(() => show(new Table(wide, make()).part(50))), attempt(() => show(new Table(wide, make()).steps()))); }
let total = 0; for (let round = 0; round < 60; round++) { const a = new Table(round % 2 === 0).fill(); total += a.length + (a[0x2000] | 0) + new Table(true).part(round * 50).length; } console.log(total);
