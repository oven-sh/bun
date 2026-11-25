// Constructors that call methods off the new object: the methods are laid first, laid late, replaced, deleted, read by accessors, hidden by own names.
const out = [];
function attempt(label, body) { try { out.push(label + " " + body()); } catch (error) { out.push(label + " " + error.constructor.name); } }
function show(p) { return Object.keys(p).join() + ":" + Object.values(p).map(String).join(); }

function Point(x, y) { this.init(x, y); }
Point.prototype.init = function (x, y) { this.x = x; this.y = y; };
Point.prototype.sum = function () { return this.x + this.y; };
function sums(k) { var n = 0; for (var i = 0; i < k; i++) { var p = new Point(i, 1); n = (n + p.sum()) | 0; } return n; }
attempt("laid first", () => sums(40));
const points = [];
function keep(k) { for (var i = 0; i < k; i++) { var p = new Point(i, i / 2); points[i & 7] = p; p.sum(); } return points.map(show).join(" "); }
attempt("kept", () => keep(20));

function Around(x, y) { this.before = 0; this.init(x, y); this.after = x; }
Around.prototype.init = function (x, y) { this.x = x; this.y = y; };
attempt("around", () => { const t = []; for (let i = 0; i < 4; i++) t.push(show(new Around(i, "s" + i))); return t.join(" "); });

function Twice(x, y) { this.x = "first"; this.init(x, y); this.y = "last"; }
Twice.prototype.init = function (x, y) { this.x = x; this.y = y; };
attempt("twice", () => { const t = []; for (let i = 0; i < 4; i++) t.push(show(new Twice(i, -0))); return t.join(" "); });

function Reading(x, y) { this.init(x, y); }
Reading.prototype.init = function (x, y) { this.y = this.x; this.x = x; };
attempt("reading", () => { const t = []; for (let i = 0; i < 4; i++) t.push(show(new Reading(i, NaN))); return t.join(" "); });

const leaked = [];
function Leaking(x, y) { this.init(x, y); }
Leaking.prototype.init = function (x, y) { this.x = x; leaked.push(Object.keys(this).join()); this.y = y; };
attempt("leaking", () => { const t = []; for (let i = 0; i < 4; i++) t.push(show(new Leaking(i, i))); return t.join(" ") + leaked.join("|"); });

function Throwing(x, y) { this.init(x, y); }
Throwing.prototype.init = function (x, y) { this.x = x; if (x === 2) throw new RangeError("two"); this.y = y; };
for (let i = 0; i < 4; i++) attempt("throwing", () => show(new Throwing(i, 1)));

function Several(x, y) { this.setX(x); this.setY(y); this.setX(y); }
Several.prototype.setX = function (x) { this.x = x; };
Several.prototype.setY = function (y) { this.y = y; };
attempt("several", () => { const t = []; for (let i = 0; i < 4; i++) t.push(show(new Several(i, i + 1))); return t.join(" "); });

function Own(x, y) { if (x === 2) this.init = function (a) { this.own = a; }; this.init(x, y); }
Own.prototype.init = function (x, y) { this.x = x; this.y = y; };
attempt("own", () => { const t = []; for (let i = 0; i < 4; i++) t.push(Object.keys(new Own(i, 1)).join()); return t.join(" "); });

function Returning(x, y) { return this.init(x, y); }
Returning.prototype.init = function (x, y) { this.x = x; this.y = y; if (x === 2) return { x: "other" }; };
attempt("returning", () => { const t = []; for (let i = 0; i < 4; i++) t.push(show(new Returning(i, 1))); return t.join(" "); });

function changing(label, change) {
  function Changed(x, y) { this.init(x, y); }
  Changed.prototype.init = function (x, y) { this.x = x; this.y = y; };
  attempt(label, () => { const t = []; for (let i = 0; i < 5; i++) { if (i === 3) change(Changed); const p = new Changed(i, 1); t.push(show(p) + "/" + p.x); } return t.join(" "); });
}
changing("replaced", C => { C.prototype.init = function (x) { this.other = x; }; });
changing("deleted", C => { delete C.prototype.init; });
changing("accessor", C => { Object.defineProperty(C.prototype, "init", { get() { return function (x) { this.got = x; }; } }); });
changing("setter", C => { Object.defineProperty(C.prototype, "x", { set(v) { this.hidden = v; }, get() { return "set" + this.hidden; } }); });
changing("read only", C => { Object.defineProperty(C.prototype, "y", { value: "fixed" }); });
changing("prototype", C => { C.prototype = { init(x) { this.third = x; } }; });
changing("parent", C => { Object.setPrototypeOf(C.prototype, { set y(v) { this.above = v; } }); });

function Late(x, y) { this.init(x, y); }
attempt("late", () => show(new Late(1, 2)));
Late.prototype.init = function (x, y) { this.x = x; this.y = y; };
attempt("late", () => show(new Late(1, 2)));
Point.prototype.init = function (x, y) { this.x = "new" + x; this.y = y; };
attempt("replaced at last", () => new Point(1, 2).sum());
console.log(out.join("\n"));
