// A mixin makes a constructor function below its parameter. The objects have one layout with the fields of the one parent that the file passes.
// STATISTIC: ClassGuardCounts >= 8
"use strict";
function Cursor(text) { this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Cursor.prototype.all = function () { var sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
Cursor.prototype.kind = function () { return "cursor"; };
Cursor.prototype.describe = function () { return this.kind() + Object.keys(this).join(); };
function Other(text) { this.pos = "other"; this.size = text.length; }
Other.prototype.all = function () { return this.size; };
Other.prototype.kind = function () { return "other"; };
Other.prototype.describe = function () { return this.kind() + Object.keys(this).join() + this.pos; };
function withMark(Base) {
    function Marked(text, mark) { Base.call(this, text); this.mark = mark; }
    Marked.prototype = Object.create(Base.prototype);
    Marked.prototype.constructor = Marked;
    Marked.prototype.kind = function () { return "marked" + this.mark + Base.prototype.kind.call(this); };
    return Marked;
}
var Marked = withMark(Cursor), Again = withMark(Cursor), text = "alpha beta gamma delta ".repeat(4), sum = 0;
for (var i = 0; i < 300; i++) { var marked = new Marked(text, i), again = new Again(text, -i); sum += marked.all() + again.all(); }
console.log(sum, marked.describe(), again.describe(), marked instanceof Cursor, marked instanceof Again, marked.constructor === Marked);
// Out of sight, another parent.
function withSize(Base) { function Sized(text) { Base.call(this, text); this.size2 = 2; } Sized.prototype = Object.create(Base.prototype); Sized.prototype.kind = function () { return "sized"; }; return Sized; }
globalThis.pass = { withSize };
var Seen = withSize(Cursor), Unseen = globalThis.pass["with" + "Size"](Other);
for (var i = 0; i < 3; i++) console.log(new Seen(text).all(), new Unseen(text).all(), new Seen("a").describe(), new Unseen("bc").describe());
// The parameter is another parent by then, or none.
function replaced(Base) { Base = Other; function Heir(text) { Base.call(this, text); this.own = 1; } Heir.prototype = Object.create(Base.prototype); return Heir; }
function chosen(Base, No) { function Heir(text) { (No || Base).call(this, text); this.own = 1; } Heir.prototype = Object.create((No || Base).prototype); return Heir; }
function literal(Base) { function Heir(text) { Base.call(this, text); this.own = 1; } Heir.prototype = { __proto__: Base.prototype, kind() { return "literal" + this.own; } }; return Heir; }
function made(Base) { function Heir(text) { Base.call(this, text); this.own = 1; } Heir.prototype = new Base("proto"); return Heir; }
for (var H of [replaced(Cursor), chosen(Cursor, Other), chosen(Cursor), literal(Cursor), made(Cursor)]) { var h = new H(text); console.log(h.describe(), h.all(), h instanceof Cursor, h instanceof Other); }
try { withMark(); } catch (e) { console.log(e instanceof TypeError); }
// What is laid or relinked later is found.
Marked.prototype.step = function () { this.pos = this.text.length; return -1; };
console.log(new Marked(text, 7).all(), new Again(text, 8).all(), new Cursor(text).all());
Object.setPrototypeOf(Again.prototype, Other.prototype);
console.log(new Again(text, 9).describe(), new Marked(text, 9).describe(), new Again("abc", 1) instanceof Cursor);
Object.defineProperty(Cursor.prototype, "value", { set(v) { this.seen = v; }, get() { return "got"; }, configurable: true });
console.log(JSON.stringify(new Marked("y", 8)), new Marked("y", 8).value);
