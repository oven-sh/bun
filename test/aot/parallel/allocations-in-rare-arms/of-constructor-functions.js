// Objects of constructor functions are kept by rare arms. The prototype object changes before, between and behind: it is replaced, gains members, loses them, the function is called with another new.target.
function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
Point.prototype.debug = function () { return "debug" + this.x; };
function Derived(x) { Point.call(this, x, x + 1); this.z = x * 2; }
Derived.prototype = Object.create(Point.prototype);
Derived.prototype.constructor = Derived;
Derived.prototype.three = function () { return this.sum() + this.z; };
function Late(x) { this.x = x; }
const verbose = process.argv.length > 40, kept = [];

function pushes(n, every) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.sum() + p.x; if (i % every === 0) kept.push(p); } return total; }
function logs(n, every) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.sum(); if (i % every === 0) kept.push(p.debug(), p); } return total; }
function derived(n, every) { let total = 0; for (let i = 0; i < n; i++) { const d = new Derived(i); total += d.three(); if (i % every === 0) kept.push(d); } return total; }
function replaces(n, every) { let total = 0; const before = Point.prototype; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.sum(); if (i % every === 0) { if (i === every) Point.prototype = { sum() { return 1000; }, debug: before.debug }; kept.push(Object.getPrototypeOf(p) === before, p); } } Point.prototype = before; return total; }
function gains(n, every) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.sum(); if (i % every === 0) { Point.prototype.sum = i & 2 ? function () { return this.x + this.y; } : function () { return this.x - this.y; }; kept.push(p, p.sum()); } } return total; }
function loses(n, every) { let total = 0; const sum = Point.prototype.sum; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.y; if (i % every === 0) { delete Point.prototype.sum; kept.push(typeof p.sum, p); Point.prototype.sum = sum; } } return total; }
function accessor(n, every) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.x; if (i === every) Object.defineProperty(Point.prototype, "tag", { get() { return "tag" + this.x; }, configurable: true }); if (i % every === 0) kept.push(p.tag, p); } delete Point.prototype.tag; return total; }
function late(n, every) { let total = 0; for (let i = 0; i < n; i++) { if (i === 5) Late.prototype.twice = function () { return this.x * 2; }; const l = new Late(i); if (l.twice) total += l.twice(); if (i % every === 0) kept.push(l); } return total; }
function reflected(n, every) { let total = 0; for (let i = 0; i < n; i++) { const p = Reflect.construct(Point, [i, 2], i % every === 0 ? Derived : Point); total += p.sum(); if (i % every === 0) kept.push(p, p instanceof Derived); } return total; }
function made(n, every) { let total = 0; for (let i = 0; i < n; i++) { const Local = function (v) { this.v = v; }; Local.prototype.id = i; const l = new Local(i); total += l.id + l.v; if (i % every === 0) kept.push(l, l.id); } return total; }
function thrown(n, every) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); try { if (i % every === 0) throw p; total += p.sum(); } catch (e) { total += e.x; kept.push(e === p, e); } } return total; }
function carried(n, every) { let last = null, total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.sum(); if (i % every === 0) last = p; } kept.push(last); return total; }
function changed(n, every) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); p.x += 1; if (i & 1) p.extra = i; total += p.sum(); if (i % every === 0) kept.push(p); } return total; }
function hidden(n, every) { let total = 0; const flags = JSON.parse("[0,1]"); for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.sum(); if (flags[i % every === 0 ? 1 : 0]) kept.push(p); if (verbose) total += p.debug(); } return total; }

const show = v => v === null ? "null" : typeof v === "object" ? (v instanceof Derived ? "D" : v instanceof Point ? "P" : "O") + "{" + Object.keys(v).map(k => k + ":" + v[k]).join(",") + "}" : String(v);
for (const every of [1, 7, 1000]) {
  for (const run of [pushes, logs, derived, replaces, gains, loses, accessor, late, reflected, made, thrown, carried, changed, hidden]) {
    kept.length = 0;
    const result = run(50, every);
    console.log(run.name, every, result, kept.length, kept.map(show).join(" ").slice(0, 300));
  }
}
