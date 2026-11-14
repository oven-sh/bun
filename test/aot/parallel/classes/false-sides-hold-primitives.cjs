// Where `e && e.prototype` takes its left side, that is a primitive: the helper links each child below its own parent, and what is read off the result is read off the right side alone.
// STATISTIC: PrototypesLaidByHelpers >= 2
"use strict";
function inherits(t, e) {
    if (typeof e !== "function" && e !== null) throw new TypeError("Super expression must either be null or a function");
    t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: true, configurable: true } });
    e && setPrototypeOf(t, e);
}
function setPrototypeOf(t, e) { return setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, setPrototypeOf(t, e); }
function Cursor(text) { this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Cursor.prototype.all = function () { var sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
Cursor.prototype.kind = function () { return "cursor"; };
Cursor.named = function () { return "named" + (this === Cursor); };
function Plant(size) { this.size = size; this.age = 1; }
Plant.prototype.grow = function () { this.age++; return this.size * this.age; };
function Marked(text, mark) { Cursor.call(this, text); this.mark = mark; }
inherits(Marked, Cursor);
function Tree(size) { Plant.call(this, size); this.leaves = size * 2; }
inherits(Tree, Plant);
function Bare() { this.bare = 1; }
function below(t, e) { t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: true, configurable: true } }); }
below(Bare, null);
var text = "alpha beta gamma delta ".repeat(4), sum = 0;
for (var i = 0; i < 300; i++) { var marked = new Marked(text, i), tree = new Tree(i); sum += marked.all() + tree.grow(); }
console.log(sum, marked.kind(), Marked.named(), tree instanceof Plant, tree instanceof Cursor, new Bare().bare, Object.getPrototypeOf(Bare.prototype), new Bare() instanceof Object);
for (var bad of [undefined, 0, "", false, NaN]) try { below(function () {}, bad); console.log("linked"); } catch (e) { console.log(e instanceof TypeError); }
// Every value that is false comes out as it is, every other one on the right side.
var values = [undefined, null, false, 0, -0, NaN, "", 0n, 1, "a", 1n, [], {}, new Boolean(false), new Number(0), function () {}, Symbol.iterator, { b: 0 }, { b: "" }, { b: { b: 5 } }, new Proxy({}, { get: function (t, k) { return k; } })];
function both(a) { return a && a.b; }
function either(a, b) { return a || b; }
function early(a) { if (!a) return a; return a.b; }
function twice(a) { var x = a && a.b; return x && x.b; }
function kept(o, a) { o.v = a && a.b; if (!o.v) return o.v; return o.v.b; }
function write(v) { return typeof v + (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? Object.keys(v).join() : typeof v === "symbol" ? "s" : typeof v === "function" ? "f" : String(v)); }
var holder = { v: undefined };
for (var r = 0; r < 3; r++) var lines = values.map(function (v) { return [both(v), either(v, "or"), early(v), twice(v), kept(holder, v), (v || { b: "none" }).b, !v ? v : "yes"].map(write).join(" "); });
console.log(lines.join("\n"));
