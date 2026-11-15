// In a loop an operator stands between a number and a value of which nothing is known: a parameter of a callback that is the same in every turn, a field read in the turn. Numbers, texts, bigints, symbols, nothing at all, and objects that answer valueOf and count how often they are asked: every answer, every error and every count as plain Bun gives them.
"use strict";
const said = [];
function tell(what, make) {
  try {
    said.push(what + ": " + String(make()));
  } catch (error) {
    said.push(what + ": " + error.constructor.name + ": " + error.message);
  }
}
let asked = 0;
const counting = step => ({ valueOf() { asked++; return step; } });
const loud = { valueOf() { asked += 100; throw new RangeError("no number here"); } };
function Field(width, height) { this.width = width; this.height = height; this.cells = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1]; }
Field.prototype.at = function (x, y) { return ((y % this.height + this.height) % this.height) * this.width + (x % this.width + this.width) % this.width; };
function around(field) {
  const list = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) list.push(function (x, y) { return field.cells[field.at(x + dx, y + dy)]; });
  return list;
}
function near(list, x, y) { let n = 0; for (let i = 0; i < list.length; i++) n += list[i](x, y); return n; }
function shifted(list, by) { let s = 0; for (let i = 0; i < list.length; i++) s = s + (i + by); return s; }
function scaled(list, by) { let s = 0; for (let i = 0; i < list.length; i++) s += (i + 1) * by; return s; }
function below(list, bound) { let c = 0; for (let i = 0; i < list.length; i++) if (i < bound) c++; return c; }
function rest(rows) { let s = 0; for (let i = 0; i < rows.length; i++) s += (i + 7) % rows[i].size; return s; }
class Shelf { constructor({ width, gap, tall }) { this.width = width; this.gap = gap; this.tall = tall; } place(i) { return i * this.width + this.gap + (this.tall ? 1 : 0); } less(i) { return i - this.gap; } under(i) { return i < this.width ? 1 : 0; } }
const holder = JSON.parse('{"v":0}');
const lose = v => { holder.v = v; return holder.v; };
let shelf = new Shelf(JSON.parse('{"width":4,"gap":2,"tall":true}'));
function places() { let s = 0; for (let i = 0; i < 16; i++) s += shelf.place(i & 7); return s; }
function lesses() { let s = 0; for (let i = 0; i < 16; i++) s += shelf.less(i & 7); return s; }
function fold(x) { return x > 16 ? x - 16 : x; }
const store = JSON.parse('{"rows":[3,20,7,31],"more":[1]}');
function folds() { let s = 0; for (let i = 0; i < store.rows.length; i++) s = s + fold(store.rows[i]); return s; }
function halves() { let s = 0; for (let i = 0; i < store.rows.length; i++) s += store.rows[i] / 2; return s; }
function unders() { let s = 0; for (let i = 0; i < 16; i++) s += shelf.under(i & 7); return s; }
const plain = new Field(4, 3), ring = around(plain), eight = [0, 0, 0, 0, 0, 0, 0, 0];
const values = [2, 2.5, -0, NaN, "3", "x", "", true, null, undefined, 5n, Symbol("s"), counting(2), loud, [4], {}, new Date(7)];
for (let round = 0; round < 3; round++) {
  for (const value of values) {
    const name = typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? "5n" : typeof value === "object" && value ? Object.prototype.toString.call(value) + (value === loud ? " loud" : "") : JSON.stringify(value) + (Object.is(value, -0) ? " minus" : "");
    asked = 0;
    tell(round + " near x " + name, () => near(ring, value, 1));
    tell(round + " near y " + name, () => near(ring, 1, value));
    tell(round + " shifted " + name, () => shifted(eight, value));
    tell(round + " scaled " + name, () => scaled(eight, value));
    tell(round + " below " + name, () => below(eight, value));
    tell(round + " rest " + name, () => rest([{ size: 3 }, { size: value }, { size: 5 }]));
    tell(round + " width " + name, () => near(around(new Field(value, 3)), 1, 1));
    shelf = new Shelf({ width: lose(value), gap: lose(2), tall: lose(true) });
    tell(round + " places by width " + name, places);
    tell(round + " unders " + name, unders);
    shelf = new Shelf({ width: lose(4), gap: lose(value), tall: lose(false) });
    tell(round + " places by gap " + name, places);
    tell(round + " lesses " + name, lesses);
    store.rows = [3, 20, value, 31];
    tell(round + " folds " + name, folds);
    tell(round + " halves " + name, halves);
    store.rows = [value, 20];
    tell(round + " folds first " + name, folds);
    said.push(round + " asked " + name + ": " + asked);
  }
}
console.log(said.join("\n"));
