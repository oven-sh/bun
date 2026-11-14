// A map of descriptors that makes `constructor` read-only names the child: it stays in sight.
// STATISTIC: ClosedPrototypeObjects >= 2
"use strict";
function Cursor(text) { this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Cursor.prototype.all = function () { var sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
function Heir(text) { Cursor.call(this, text); this.extra = 1; }
Heir.prototype = Object.create(Cursor.prototype, { constructor: { value: Heir } });
Heir.prototype.more = function () { return this.extra + this.pos; };
var text = "alpha beta gamma delta ".repeat(4), sum = 0;
for (var i = 0; i < 300; i++) { var heir = new Heir(text); sum += heir.all() + heir.more(); }
console.log(sum, heir instanceof Heir, heir instanceof Cursor, Object.keys(heir).join());
