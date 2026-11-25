// Fields of numbers compared by ==, !=, ===, !== in loops and in methods that loops call; the fields hold other things at times.
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "{}" : typeof v === "string" ? JSON.stringify(v) : String(v);
globalThis.act = null; const unseen = (0, eval)("(function (o, i) { return globalThis.act ? globalThis.act(o, i) : 0; })");
function Box(n) { this.a = 0.5; this.b = 5; this.c = 5; this.d = 5; this.n = n; }
Box.prototype.m0 = function (i) { let sum = 0; ++this.c; if (this.a == this.a) { this.c += 1; } else if (this.b === 3) sum += 3; this.d = this.a >> 1; return sum; };
Box.prototype.m1 = function (i) { let sum = 0; this.c *= 0.5; if (this.b == this.a) { this.d -= 2; } else if (this.a != "1") sum += 3; this.d = 0; return sum; };
Box.prototype.run = function (n, at) { let sum = 0, guard = 0; for (let i = 0; i < n; i++) { sum += this.m0(i); sum += (this.d === -0) ? 1 : 2; if (i === at) unseen(this, i); switch (this.a) { case 1: sum += 5; break; case 0: sum -= 1; } if (guard > 2000) break; } return sum; };
globalThis.boxes = [Box]; const tables = [Box.prototype.m0, Box.prototype.m1];
const values = ["1", "", null, undefined, NaN, -0, 2 ** 31, 2 ** 53, 0.5, true, false, 3n, { valueOf() { return 1; } }, { toString() { return "0"; } }, Symbol.iterator, "x", [], [1], Infinity];
const acts = [null, o => Object.freeze(o), o => Object.seal(o), o => { delete o.b; }, o => { Object.defineProperty(o, "a", { get() { return 1; }, set(v) {}, configurable: true }); }, o => { o.extra = 1; }, o => { Object.setPrototypeOf(o, { __proto__: Box.prototype, get b() { return 2; } }); }, o => { throw new RangeError("stop"); }];
for (const v of values) acts.push(o => { o.c = v; });
for (const v of values) if (Math.abs(String(typeof v).length - 6) < 9) acts.push(o => { o.b = v; });
const makes = [() => new Box(4), () => { const b = new Box(2); b.c = "2"; return b; }, () => { class Low extends Box { constructor() { super(1); this.own = 1; } } return new Low(); }, () => new Proxy(new Box(3), {}), () => { const b = Object.create(Box.prototype); b.a = 1; return b; }];
for (const [m, make] of makes.entries()) for (const [a, what] of acts.entries()) { if (m > 1 && a % 3) continue; globalThis.act = what; let said, box; try { box = make(); said = box.run(14, 6); } catch (e) { said = e.constructor.name; } let left; try { left = ["a", "b", "c", "d"].map(k => show(box[k])).join() + Object.keys(box); } catch (e) { left = e.constructor.name; } console.log(m, a, show(said), left); }
globalThis.act = null; let total = 0; for (let r = 0; r < 60; r++) { const b = new Box(r & 3); total += b.run(20, -1); for (let k = 0; k < 6; k++) total += tables[k & 1].call(b, k) || 0; } console.log("again", show(total));
