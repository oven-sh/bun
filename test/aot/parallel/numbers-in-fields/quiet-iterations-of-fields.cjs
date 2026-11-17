// Loops over fields where some iterations run other code and the others do not: what is known of the object, its slots, views and lists is asked again behind the former alone.
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? (v.length !== undefined ? "[" + Array.from(v).slice(0, 9) + "]" : "{}") : typeof v === "string" ? JSON.stringify(v) : String(v);
globalThis.act = null; const unseen = (0, eval)("(function (o, i) { return globalThis.act ? globalThis.act(o, i) : 0; })");
function Core(n) { this.a = 0; this.b = 5; this.c = 1; this.d = 0; this.view = new Int32Array(n); this.list = []; for (let i = 0; i < n; i++) this.list.push(i); this.n = n; }
Core.prototype.out = function (i) { return unseen(this, i); }; Core.prototype.quiet = function () { this.d++; };
Core.prototype.run = function (n, at) { let sum = 0, kept = 0, held = 0; for (let i = n; --i > -1;) { this.view[this.a++] = 0xF0F0; sum += this.b; if (this.a === this.n) { this.a = 0; unseen(this, i); } } return [sum, kept, held, i0(this)].join(); };
function i0(o) { return [o.a, o.b, o.c, o.d].map(show).join(); }
globalThis.cores = [Core];
const values = ["1", null, undefined, NaN, -0, 2 ** 31, 0.5, true, 3n, { valueOf() { seen++; return 1; } }, "x", [], Infinity]; let seen = 0;
const acts = [null, o => Object.freeze(o), o => Object.seal(o), o => { delete o.d; }, o => { Object.defineProperty(o, "b", { get() { seen++; return 1; }, set(v) { seen += 2; }, configurable: true }); }, o => { o.extra = 1; }, o => { Object.setPrototypeOf(o, { __proto__: Core.prototype, get a() { return 2; }, out() { return 5; } }); }, (o, i) => { if (i > 20) throw new RangeError("stop"); }, o => { o.view = new Uint8Array(3); }, o => { o.view = []; }, o => { o.view.buffer && o.view.buffer.transfer && o.view.buffer.transfer(); }, o => { o.list = new Float64Array(8); }, o => { o.list.length = 1; }, o => { o.list = null; }, o => { Object.freeze(o.list); }, () => 9, () => 8, o => { o.a = 2; }, o => { o.n = 4; }, o => { Core.prototype.out = function () { return 7; }; }, o => { o.out = () => 3; }];
for (const v of values) acts.push(o => { o.b = v; });
for (const v of values) acts.push(o => { o.a = v; });
const out = Core.prototype.out;
const makes = [() => new Core(12), () => new Core(0), () => { class Low extends Core { out(i) { return super.out(i); } } return new Low(9); }, () => new Proxy(new Core(5), {}), () => { const o = new Core(6); o.b = "4"; return o; }];
for (const [m, make] of makes.entries()) for (const [a, what] of acts.entries()) { if (m > 1 && a % 4) continue; globalThis.act = what; seen = 0; let said, o; try { o = make(); said = o.run(40, 11); } catch (e) { said = e.constructor.name; } let left; try { left = i0(o) + show(o.view) + show(o.list) + Object.keys(o); } catch (e) { left = e.constructor.name; } console.log(m, a, said, left, seen); Core.prototype.out = out; }
globalThis.act = null; let total = ""; for (let r = 0; r < 40; r++) { const o = new Core(8 + r); total = o.run(60 + r, -1); } console.log("again", total);
