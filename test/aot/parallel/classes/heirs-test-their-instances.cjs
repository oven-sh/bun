// An heir asks whether its new object is an instance before the parent fills it: the object is seen by nobody until every field is filled.
// STATISTIC: ArithmeticOnMarkers <= 1
"use strict";
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function inherits(t, e) { t.prototype = Object.create(e.prototype, { constructor: { value: t, writable: true, configurable: true } }); }
function Cursor(text) { _classCallCheck(this, Cursor); this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Cursor.prototype.all = function () { var sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
function Marked(text, mark) { _classCallCheck(this, Marked); Cursor.call(this, text); this.mark = mark; }
inherits(Marked, Cursor);
Marked.prototype.sum = function () { return this.mark + this.pos; };
function Word(text) { if (!(this instanceof Word)) return new Word(text); var _this = Cursor.call(this, text) || this; _this.word = 1; return _this; }
inherits(Word, Cursor);
var text = "alpha beta gamma delta ".repeat(4), sum = 0;
for (var i = 0; i < 300; i++) { var marked = new Marked(text, i), word = new Word(text); sum += marked.all() + marked.sum() + word.all(); }
console.log(sum, Object.keys(marked).join(), Object.keys(word).join(), Word("a b").all(), word instanceof Cursor, marked instanceof Word);
try { Marked("a"); } catch (e) { console.log(e.message); }
try { Cursor.call({}, "a"); } catch (e) { console.log(e.message); }
