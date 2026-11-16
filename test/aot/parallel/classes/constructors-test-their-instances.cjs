// A constructor function that asks whether its new object is an instance hands it to nobody: the fields are filled before anybody sees the object.
// STATISTIC: SlotsCarriedAroundLoops >= 1
"use strict";
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function Cursor(text) { _classCallCheck(this, Cursor); this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Cursor.prototype.all = function () { var sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
function Point(x, y) { if (!(this instanceof Point)) return new Point(x, y); this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
function Pair(a) { if (!(this instanceof Pair)) throw new TypeError("new"); this.a = a; this.b = a + 1; }
Pair.prototype.sum = function () { return this.a + this.b; };
var text = "alpha beta gamma delta ".repeat(4), sum = 0;
for (var i = 0; i < 300; i++) { var cursor = new Cursor(text), point = new Point(i, 1), pair = new Pair(i); sum += cursor.all() + point.sum() + pair.sum(); }
console.log(sum, Object.keys(cursor).join(), Object.keys(point).join(), Point(3, 4).sum(), new Pair(2).sum());
try { Cursor("a"); } catch (e) { console.log(e.message); }
try { Pair.call({}, 1); } catch (e) { console.log(e.message); }
console.log(1);
