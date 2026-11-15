// F.prototype.m = closure in front of the variables that it reads: what the closure finds depends on where F is used.
function show(name, f) {
  let v;
  try { v = f(); } catch (e) { v = e.constructor.name; }
  console.log(name, typeof v, Array.isArray(v) ? JSON.stringify(v) : typeof v === "function" ? "function" : String(v));
}
function Task(n) { this.n = n; this.state = 0; }
Task.prototype.isHeld = function () { return (this.state & HELD) != 0 || this.state == SUSPENDED; };
Task.prototype.next = function (k) { if (this.state == SUSPENDED) { this.state = RUNNING; return 1; } this.state = k & 1 ? SUSPENDED : HELD; return this.state | SUSPENDED; };
Task.prototype.kind = "task";
Task.prototype.all = function () { return [typeof RUNNING, typeof SUSPENDED, typeof HELD, typeof label, typeof list, this.kind]; };
show("in front", () => new Task(1).all());
var RUNNING = 0;
show("behind one", () => Task.prototype.all.call({ kind: 1 }));
var SUSPENDED = 2;
var HELD = 4;
var label = "abc";
var list = [3, 1, 2];
show("behind all", () => new Task(1).all());
show("states", () => { const t = new Task(2); let s = 0; for (let i = 0; i < 200; i++) s += t.next(i) + (t.isHeld() ? 1 : 0); return s; });

function Quiet(n) { this.n = n; }
Quiet.prototype.read = function () { let s = 0; for (let i = 0; i < 100; i++) s = (s + limit + words[i & 1].length + i) | 0; return s + this.n; };
Quiet.prototype.made = function () { return new Array(limit).length; };
var Held = function (n) { this.n = n; };
Held.prototype.read = function () { return limit * this.n; };
var limit = 6;
var words = ["a", "bcd"];
show("quiet", () => new Quiet(1).read());
show("made", () => new Quiet(1).made());
show("held", () => new Held(7).read());

function Base() {}
Base.prototype.read = function () { return base; };
function Derived() {}
Derived.prototype = Object.create(Base.prototype);
Derived.prototype.own = function () { return [typeof base, typeof after]; };
show("derived in front", () => new Derived().own());
var base = 5, after = 6;
show("derived behind", () => [...new Derived().own(), new Derived().read()]);

function Watched() {}
Object.defineProperty(Watched.prototype, "late", { set(f) { show("setter", () => f.call({ n: 1 })); }, configurable: true });
Watched.prototype.late = function () { return [typeof watched, this.n]; };
var watched = 8;
Object.defineProperty(Watched.prototype, "late", { value: function () { return watched; }, configurable: true });
show("redefined", () => new Watched().late());

function Shown() {}
exports.Shown = Shown;
Shown.prototype.read = function () { return typeof shown; };
show("shown in front", () => new exports.Shown().read());
var shown = 1;
show("shown behind", () => new exports.Shown().read());

function Alias() {}
var aliased = Alias.prototype;
aliased.read = function () { return typeof alias; };
show("alias in front", () => new Alias().read());
var alias = 1;
show("alias behind", () => new Alias().read());
function early() { return new Late().read(); }
function Late() {}
Late.prototype.read = function () { return late; };
show("early", early);
var late = 3;
show("late", early);
