// The slots that operators of a stretch read are asked for numbers before its first store. Whatever else they hold, and whatever a conversion changes amid the stretch, is computed as written.
const log = [];
function Cell(a, b, c) { this.a = a; this.b = b; this.c = c; this.total = 0; }
Cell.prototype.step = function (shift) { this.total += this.a >> shift; this.a += this.b; this.b = (this.b * 5 + 1) & 255; this.c -= this.a - this.b; return this.total + this.c; };
Cell.prototype.run = function (turns) { for (let turn = 0; turn < turns; turn++) { this.total += this.a >> 1; this.a += this.b; --this.b; this.c = this.c + this.a * 2; if (this.c > 1e6) this.c -= 1e6; while (this.b < -3) this.b += 7; } return this.total; };
Cell.prototype.drive = function (turns) { let last = 0; for (let turn = 0; turn < turns; turn++) last = this.step(turn & 3); return last; };
const show = cell => [cell.total, cell.a, cell.b, cell.c].map(value => typeof value + ":" + String(Object.is(value, -0) ? "-0" : value)).join(" ") + " " + Object.keys(cell);
const attempt = run => { try { return String(run()); } catch (error) { return error.name; } };
if (typeof hostCells === "function") hostCells(new Cell(hostCells, hostCells, hostCells));
const deeds = {
  nothing() {}, text(cell) { cell.c = "text"; }, remove(cell) { delete cell.b; }, freeze(cell) { Object.freeze(cell); }, fraction(cell) { cell.a = 0.5; }, big(cell) { cell.total = 7n; },
  accessor(cell) { Object.defineProperty(cell, "c", { get() { log.push("get"); return 3; }, set(value) { log.push("set " + value); }, configurable: true, enumerable: true }); },
  readonly(cell) { Object.defineProperty(cell, "a", { writable: false }); }, prototype(cell) { delete cell.total; Object.setPrototypeOf(cell, { __proto__: Cell.prototype, set total(value) { log.push("total " + value); }, get total() { return 40; } }); },
};
for (const [name, deed] of Object.entries(deeds)) {
  for (const where of ["before", "amid"]) {
    const cell = new Cell(100, 3, 7);
    if (where === "amid") cell.b = { valueOf() { deed(cell); return 2; } }; else deed(cell);
    console.log(name, where, attempt(() => cell.run(5)), show(cell), attempt(() => cell.drive(5)), show(cell), log.splice(0).join());
  }
}
for (const value of [0, -0, 1.5, NaN, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), 2 ** 32, 2 ** 53, 2 ** 53 + 2, Infinity, "8", "", undefined, null, true, false, 3n, Symbol.iterator, [], [2], {}]) {
  for (const place of ["a", "b", "c", "total"]) {
    const cell = new Cell(5, 6, 7); cell[place] = value;
    console.log(place, attempt(() => cell.run(7)), attempt(() => show(cell)), attempt(() => cell.drive(3)), attempt(() => show(cell)));
  }
}
