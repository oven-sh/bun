// A helper makes each child's prototype with a map of descriptors. It links each child below its own parent. A map or an entry that somebody else keeps is seen.
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
// A helper that keeps its maps, one that keeps an entry, one that returns a literal of the same shape, one that writes two entries.
var maps = [], entries = [];
function keepsMap(t, e) { var map = { constructor: { value: t, writable: true, configurable: true } }; maps.push(map); t.prototype = Object.create(e.prototype, map); }
function keepsEntry(t, e) { var entry = { value: t, writable: true, configurable: true }; entries.push(entry); t.prototype = Object.create(e.prototype, { constructor: entry }); }
function returns(t, e) { t.prototype = Object.create(e.prototype, { constructor: { value: t, writable: true, configurable: true } }); return { value: t, writable: true, configurable: true }; }
function twoEntries(t, e) { t.prototype = Object.create(e.prototype, { constructor: { value: t, writable: true, configurable: true }, above: { value: e, enumerable: true } }); }
function readOnly(t, e) { t.prototype = Object.create(e.prototype, { constructor: { value: t } }); }
function S1(n) { Plant.call(this, n); this.own = 1; } function S2(n) { Cursor.call(this, n + ""); this.own = 2; }
var given = [];
[keepsMap, keepsEntry, returns, twoEntries, readOnly].forEach(function (link) {
    given.push(link(S1, Plant), link(S2, Cursor));
    var a = new S1(3), b = new S2(4);
    console.log(link.name, a.kind(), b.kind(), a.grow(), b.all(), a.constructor === S1, b.constructor === S2, a.above === Plant, b.above === Cursor, Object.keys(S1.prototype).join());
    try { S1.prototype.constructor = Plant; } catch (e) { console.log(e instanceof TypeError); }
    console.log(new S1(1).constructor === Plant);
});
console.log(new (maps[0].constructor.value)(5).grow(), new (maps[1].constructor.value)(5).all(), new (entries[0].value)(6).grow(), entries[1].value === S2, given.map(function (g) { return g ? g.value.name + Object.keys(g).join("") : "-"; }).join());
// What is changed later is found.
Oak.prototype.grow = function () { return -1; };
console.log(new Oak(2).grow(), new Tree(2).grow());
inherits(Marked, Plant);
console.log(new Marked(text, 5).kind(), new Marked("ab", 5) instanceof Cursor, new Marked("ab", 5) instanceof Plant, marked instanceof Cursor, marked.all());
try { inherits(Tree); console.log(Tree.super_ === Plant); inherits(Tree, { prototype: null }); console.log(Object.getPrototypeOf(Tree.prototype)); inherits(Tree, { prototype: 5 }); } catch (e) { console.log(e instanceof TypeError); }
