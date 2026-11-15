// util.inherits and Babel's _inherits define by descriptors: each child is linked below its own parent. A descriptor that only sets flags lays nothing.
// STATISTIC: PrototypesLaidByHelpers >= 3
"use strict";
var inherits = require("util").inherits;
function _inherits(t, e) {
    if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");
    t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);
}
function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); }
function Cursor(text) { this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Cursor.prototype.all = function () { var sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
function Plant(size) { this.size = size; this.age = 1; }
Plant.prototype.grow = function () { this.age++; return this.size * this.age; };
Plant.named = function () { return this === Plant ? "plant" : "below"; };
function Marked(text, mark) { Cursor.call(this, text); this.mark = mark; }
inherits(Marked, Cursor);
function Tree(size) { Plant.call(this, size); this.leaves = size * 2; }
inherits(Tree, Plant);
function Oak(size) { Plant.call(this, size); this.name = "oak"; }
_inherits(Oak, Plant);
function Word(text) { Cursor.call(this, text); this.word = 1; }
_inherits(Word, Cursor);
var text = "alpha beta gamma delta ".repeat(4), sum = 0;
for (var i = 0; i < 300; i++) sum += new Marked(text, i).all() + new Tree(i).grow() + new Oak(i).grow() + new Word(text).all();
console.log(sum, Marked.super_ === Cursor, Tree.super_ === Plant, Oak.named(), new Oak(1) instanceof Plant, new Word("a") instanceof Cursor, new Word("a") instanceof Plant);
try { Oak.prototype = {}; } catch (e) { console.log(e instanceof TypeError); }
try { Object.defineProperty(Oak, "prototype", { value: {} }); } catch (e) { console.log(e instanceof TypeError); }
console.log(Object.getOwnPropertyDescriptor(Oak, "prototype").writable, Object.getOwnPropertyDescriptor(Tree, "prototype").writable, Object.getOwnPropertyDescriptor(Tree, "super_").enumerable);
Tree.super_ = 5;
console.log(Tree.super_, Object.keys(Tree).join());
