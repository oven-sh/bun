// A mixin that the file calls with several parents is copied for each: each copy's objects have one layout with the fields of its own parent.
// STATISTIC: FieldsOutOfLine = 0
"use strict";
function Cursor(text) { this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Cursor.prototype.all = function () { var sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
Cursor.prototype.kind = function () { return "cursor"; };
function Plant(size) { this.size = size; this.age = 1; }
Plant.prototype.all = function () { return this.size * this.age++; };
Plant.prototype.kind = function () { return "plant"; };
function withMark(Base) {
    function Marked(given, mark) { Base.call(this, given); this.mark = mark; }
    Marked.prototype = Object.create(Base.prototype);
    Marked.prototype.constructor = Marked;
    Marked.prototype.kind = function () { return "marked" + this.mark + Base.prototype.kind.call(this); };
    return Marked;
}
var MarkedCursor = withMark(Cursor), MarkedPlant = withMark(Plant), Twice = withMark(MarkedPlant);
var text = "alpha beta gamma delta ".repeat(4), sum = 0;
for (var i = 0; i < 300; i++) { var cursor = new MarkedCursor(text, i), plant = new MarkedPlant(i, -i), twice = new Twice(i, 2); sum += cursor.all() + plant.all() + twice.all(); }
console.log(sum, cursor.kind(), plant.kind(), twice.kind(), Object.keys(cursor).join(), Object.keys(plant).join(), Object.keys(twice).join());
console.log(cursor instanceof Cursor, plant instanceof Cursor, plant instanceof Plant, twice instanceof MarkedPlant, twice instanceof Plant, MarkedCursor === MarkedPlant);
// The same by a function that is called where it is written.
var Wrapped = (function (Parent) { return (function (_super) { function Heir(given) { _super.call(this, given); this.own = 1; } Heir.prototype = Object.create(_super.prototype); return Heir; })(Parent); })(Cursor);
for (i = 0, sum = 0; i < 300; i++) sum += new Wrapped(text).all();
console.log(sum, new Wrapped("a b").kind(), new Wrapped("") instanceof Cursor);
// What is relinked later is found.
Object.setPrototypeOf(MarkedPlant.prototype, Cursor.prototype);
console.log(new MarkedPlant(3, 4).kind(), new Twice(3, 4).kind(), new MarkedPlant(3, 4) instanceof Cursor, new MarkedCursor("a b", 1).all());
