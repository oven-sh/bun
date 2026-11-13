// A helper makes each child's prototype with a map of descriptors. It links each child below its own parent.
// STATISTIC: PrototypesLaidByHelpers >= 3
"use strict";
function inherits(ctor, superCtor) {
    if (superCtor) {
        ctor.super_ = superCtor;
        ctor.prototype = Object.create(superCtor.prototype, { constructor: { value: ctor, enumerable: false, writable: true, configurable: true } });
    }
}
function Cursor(text) { this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Cursor.prototype.all = function () { var sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
Cursor.prototype.kind = function () { return "cursor"; };
function Plant(size) { this.size = size; this.age = 1; }
Plant.prototype.grow = function () { this.age++; return this.size * this.age; };
Plant.prototype.kind = function () { return "plant"; };
function Marked(text, mark) { Cursor.call(this, text); this.mark = mark; }
inherits(Marked, Cursor);
Marked.prototype.kind = function () { return "marked" + this.mark + Cursor.prototype.kind.call(this); };
function Tree(size) { Plant.call(this, size); this.leaves = size * 2; }
inherits(Tree, Plant);
Tree.prototype.kind = function () { return "tree" + this.leaves + Plant.prototype.kind.call(this); };
function Oak(size) { Tree.call(this, size); this.name = "oak"; }
inherits(Oak, Tree);
var text = "alpha beta gamma delta ".repeat(4), sum = 0;
for (var i = 0; i < 300; i++) { var marked = new Marked(text, i), tree = new Tree(i), oak = new Oak(i); sum += marked.all() + tree.grow() + oak.grow(); }
var keys = function (o) { return Object.keys(o).join() + "|" + Object.getOwnPropertyNames(Object.getPrototypeOf(o)).join(); };
console.log(sum, marked.kind(), tree.kind(), oak.kind(), keys(marked), keys(tree), keys(oak));
console.log(marked instanceof Cursor, oak instanceof Plant, oak instanceof Cursor, oak.constructor === Oak, Oak.super_ === Tree, Marked.super_ === Cursor);
