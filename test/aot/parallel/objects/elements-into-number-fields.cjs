// Elements of arrays go into number fields, under keys that are numbers, undefined or null.
function Tray(below) { this.below = below; this.used = 0; this.next = 0; this.cups = new Array(4); }
Tray.prototype.lay = function (v) {
  for (let place = 3; place >= 0; place--) {
    this.next = this.next < 20 ? this.next + 3 : 1;
    this.cups[place] = v === undefined ? this.next : v;
  }
};
Tray.prototype.take = function (from) {
  const place = from.used;
  if (!(place > 3)) {
    from.used = place + 1;
    this.used = from.cups[place];
  }
  return this.used;
};
Tray.prototype.at = function (from, key) { this.used = from.cups[key]; return this.used; };
class Cell { constructor() { this.value = 0.5; this.list = [1, 2, 3]; } read(from, k) { this.value = from.list[k]; return this.value; } }
const show = v => Object.is(v, -0) ? "-0" : typeof v + " " + String(v);
const zero = process.argv.length > 100 ? 1 : 0;
const first = new Tray(null), second = new Tray(first);
first.lay();
for (let turn = 0; turn < 6; turn++) console.log(show(second.take(first)), show(first.used), show(second.used));
for (const v of [0.5, -0, 2 ** 31, 2 ** 53, 0 / zero, 1 / zero]) { first.lay(v); first.used = 0; console.log(show(second.take(first)), show(second.at(first, 3)), show(second.at(first, 7))); }
for (const key of [0, 1.5, -1, zero - zero, undefined, null, "1", "x", 2 ** 32 - 1, 0 / zero]) console.log(String(key), show(second.at(first, key)));
first.cups[2] = undefined; console.log(show(second.at(first, 2)), show(second.take(first)));
first.cups = [, 7]; console.log(show(second.at(first, 0)), show(second.at(first, 1)));
first.used = undefined; console.log(show(second.take(first)), show(first.used));
const cell = new Cell(), other = new Cell(); other.list = [0.25, , 3];
for (const k of [0, 1, 2, 3, 0.5, undefined]) console.log(show(cell.read(other, k)), show(cell.value));
