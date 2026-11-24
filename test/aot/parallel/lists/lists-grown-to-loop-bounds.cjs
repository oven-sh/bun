// Loops with constant bounds fill lists under their counter: in fields, with arms, with lists that others change meanwhile, and that take no elements.
const show = a => a.length + ":" + Array.from({ length: Math.min(a.length, 40) }, (x, i) => i in a ? String(a[i]) : "_").join() + ";" + String(a[a.length - 1]) + ";" + Object.keys(a).length;
const attempt = f => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
globalThis.change = null; const changes = (0, eval)("(function (list, i) { return globalThis.change ? globalThis.change(list, i) : 0; })");
function Fence(painted, posts) { this.painted = painted; this.posts = posts || []; }
Fence.prototype.gate = function () { return 1; }; Fence.prototype.gap = function () { return 2; };
Fence.prototype.build = function () { for (var post = 0; post < 12000; post++) { if (post >= 5000) { if (this.painted) this.posts[post] = post; else this.posts[post] = post / 4; } else this.posts[post] = this.gate; } return this.posts; };
Fence.prototype.stretch = function (end) { for (var post = 0; post < 5000; post++) { if (post === end) break; this.posts[post] = post; if (post === 20) changes(this.posts, post); } return this.posts; };
Fence.prototype.pairs = function () { for (let post = 0; post < 300; post++) { if (post % 3 === 1) continue; this.posts[post] = this.painted ? "s" + post : post * 0.5; } return this.posts; };
for (const painted of [false, true, "yes"]) { const a = new Fence(painted).build(); console.log(a.length, a[0] === a[100], a[5001], a[11999], a[12000], a.indexOf(undefined)); }
for (const end of [0, 1, 7, 21, 22, 64, 1000, 5000, -1]) console.log(show(new Fence(true).stretch(end)));
const acts = { shorter: l => { l.length = 3; }, frozen: l => { Object.freeze(l); }, pushed: l => { l.push("p", "q"); }, popped: l => { l.pop(); l.pop(); }, holes: l => { delete l[2]; }, ahead: l => { l[l.length + 4] = "far"; }, getter: l => { Object.defineProperty(l, 30, { get() { return "g"; }, set(v) {}, configurable: true }); }, reversed: l => { l.reverse(); }, sealed: l => { Object.preventExtensions(l); }, sorted: l => { l.sort(); }, unshifted: l => { l.unshift("u"); } };
for (const name in acts) { globalThis.change = acts[name]; const fence = new Fence(true); console.log(name, attempt(() => show(fence.stretch(100))), show(fence.posts)); globalThis.change = null; }
class Own extends Array {}
const lists = [() => [1, 2, 3], () => [0.5], () => ["a"], () => new Array(10), () => new Array(6000), () => [, 1], () => Object.freeze([1]), () => Object.seal([1, 2]), () => new Own(), () => { const a = []; a[4000] = 1; return a; }, () => { const a = []; a.extra = 1; return a; }, () => { const a = [1, 2, 3]; a.length = 0; return a; }, () => { const a = [1, 2, 3]; a.shift(); return a; }, () => { const a = []; Object.defineProperty(a, "length", { writable: false }); return a; }, () => "a,b".split(",")];
for (const make of lists) { for (const painted of [true, false]) console.log(attempt(() => show(new Fence(painted, make()).stretch(50))), attempt(() => show(new Fence(painted, make()).pairs()))); }
let total = 0; for (let round = 0; round < 60; round++) { const a = new Fence(round % 2 === 0).build(); total += a.length + (a[8000] | 0) + new Fence(true).stretch(round * 50).length; } console.log(total);
