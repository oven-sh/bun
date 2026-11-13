// Methods that a constructor calls off its new object lay fields: in several files' ways, in other orders, under conditions, again later, and for other objects.
const out = [];
function attempt(label, body) { try { out.push(label + " " + body()); } catch (error) { out.push(label + " " + error.constructor.name); } }
const show = o => Object.keys(o).join() + ":" + Object.values(o).map(String).join();

function Box(n) { this.data = new Uint8Array(n); this.count = n; this.hits = 0; this.late(); }
Box.prototype.late = function () { this.sum = 0; this.steps = 0; this.ratio = 0.5; };
Box.prototype.run = function () { for (let i = 0; i < this.count; i++) { this.hits += i; this.steps++; this.sum ^= i; this.ratio = this.ratio * 0.99 + 0.01; } return show(this); };
attempt("box", () => { const b = new Box(5); return b.run() + b.run() + (b.late(), b.run()); });
attempt("late deleted", () => { const b = new Box(2); delete b.steps; return b.run() + ("steps" in b); });

function Nested(n) { this.init(n); this.last = n; }
Nested.prototype.init = function (n) { this.reset(n); this.inner = [n]; };
Nested.prototype.reset = function (n) { this.state = n ? "on" : undefined; this.n = n; };
attempt("nested", () => [0, 1, 2].map(n => show(new Nested(n))).join(" "));

function Some(n) { if (n > 1) this.init(n); }
Some.prototype.init = function (n) { this.a = n; if (n > 2) this.b = n; };
attempt("some", () => [1, 2, 3].map(n => { const s = new Some(n); return show(s) + s.a + s.b; }).join(" "));

function Reading(n) { this.init(); this.n = n; }
Reading.prototype.init = function () { this.seen = this.n; this.own = "n" in this; };
attempt("reading", () => show(new Reading(4)));

function Applied() { this.init.apply(this, arguments); }
Applied.prototype = { init(a, b) { this.a = a; this.b = b; }, sum() { return this.a + this.b; } };
attempt("applied", () => { let t = ""; for (let i = 0; i < 3; i++) t += new Applied(i, i / 2).sum() + ";"; return t + show(new Applied(1)); });

function Replaced(n) { this.init(n); }
Replaced.prototype.init = function (n) { this.first = n; };
attempt("replaced", () => { const a = show(new Replaced(1)); Replaced.prototype.init = function (n) { this.second = n; }; return a + show(new Replaced(2)); });

function Setter(n) { this.init(n); }
Setter.prototype.init = function (n) { this.value = n; this.after = this.kept; };
Object.defineProperty(Setter.prototype, "value", { set(v) { this.kept = v * 2; }, get() { return this.kept; } });
attempt("setter", () => show(new Setter(3)) + new Setter(4).value);

function Above() { this.init(); }
Above.prototype.init = function () { this.kind = "above"; };
function Below() { Above.call(this); this.own = 1; }
Below.prototype = Object.create(Above.prototype);
Below.prototype.init = function () { this.kind = "below"; this.extra = 2; };
attempt("below", () => show(new Above()) + show(new Below()));

function Throwing(n) { try { this.init(n); } catch (error) { this.error = error.message; } }
Throwing.prototype.init = function (n) { this.a = n; if (n === 1) throw new Error("one"); this.b = n; };
attempt("throwing", () => [0, 1].map(n => show(new Throwing(n))).join(" "));

const kept = [];
function Leaking(n) { this.init(n); }
Leaking.prototype.init = function (n) { this.a = n; kept.push(this); kept[0].c = kept.length; this.b = n; };
attempt("leaking", () => { new Leaking(1); new Leaking(2); return kept.map(show).join(" "); });

class Plain { constructor(n) { this.n = n; this.late(); } late() { this.sum = 0; this.list = []; } add(v) { this.sum += v; this.list.push(v); return this; } }
attempt("class", () => { const p = new Plain(1); for (let i = 0; i < 4; i++) p.add(i / 2); return show(p); });
class Heir extends Plain { late() { this.other = "o"; } }
attempt("heir", () => { const h = new Heir(2); return show(h) + h.sum + h.list; });
console.log(out.join("\n"));
