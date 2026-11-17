// What the program itself stores says what a field holds, though unseen code may store anything: numbers, a view under a late name, a table on the prototype. Other values still come.
function Meter() { this.count = 0; this.sum = 0; this.level = 1.5; this.mixed = 0; this.name = "meter"; this.state = null; }
Meter.prototype.table = [function (m) { m.sum += 1; }, function (m) { m.sum -= 2; }, function (m) { m.sum ^= 5; }, function (m) { m.late = (m.late + 1) & 7; }];
Meter.prototype.limit = 12;
Meter.prototype.start = function (size) { this.late = 0; this.view = new Uint8Array(size); this.cells = new Array(size).fill(2.5); };
Meter.prototype.load = function (values) { let at = 0; this.count = values[at++]; this.sum = values[at++]; this.level = values[at++]; this.late = values[at++]; };
Meter.prototype.label = function () { this.mixed = "text"; };
Meter.prototype.run = function (turns) {
  for (let turn = 0; turn < turns; turn++) {
    this.count += turn & 3;
    this.table[this.count & 3](this);
    this.sum += this.view[this.late] + this.cells[this.late];
    this.level *= 1.0625;
    if (this.sum > this.limit * 100) this.sum -= this.limit;
    this.mixed += 1;
  }
};
Meter.prototype.show = function () { return [this.count, this.sum, this.level, this.mixed, this.late, this.name].map(String).join(" | "); };
function open() { return typeof hostValues === "function" ? hostValues() : [1, 2, 3, 4]; }
function hand(meter) { if (typeof hostStore === "function") hostStore(meter); }
function attempt(run) { try { return run(); } catch (error) { return error.name; } }

const plain = new Meter(); plain.start(8); hand(plain); plain.run(200);
console.log(plain.show());
const loaded = new Meter(); loaded.start(8); if (loaded.count) loaded.load(open()); loaded.load([7, "9", 2n, 3]);
console.log(attempt(() => { loaded.run(30); return loaded.show(); }), loaded.show());
for (const value of ["5", "", null, undefined, true, 2 ** 31, -0, NaN, 1.5, 4n, Symbol.iterator, { valueOf() { return 3; } }, [6]]) {
  const meter = new Meter(); meter.start(8); meter.sum = value; meter.late = 1;
  console.log(typeof value, attempt(() => { meter.run(9); return meter.show(); }));
  const other = new Meter(); other.start(8); other.count = value;
  console.log(attempt(() => { other.run(9); return other.show(); }));
}
const labelled = new Meter(); labelled.start(4); labelled.label(); labelled.run(6); console.log(labelled.show());
const replaced = new Meter(); replaced.start(8); replaced.table = [m => { m.sum += 100; }, "no function", m => { m.sum = "s"; }, null];
console.log(attempt(() => { replaced.run(3); return "ran"; }), replaced.show());
const swapped = new Meter(); swapped.start(8);
for (const view of [new Float64Array([0.5, 1.5]), [1, , 3], "0123", { 0: 4, 1: 5 }, undefined]) { swapped.view = view; swapped.late = 1; console.log(attempt(() => { swapped.run(4); return "ran"; }), swapped.show()); }
Meter.prototype.limit = "3"; const texts = new Meter(); texts.start(8); texts.run(40); console.log(texts.show());
