// Elements of arrays go into number fields, under keys that are numbers, undefined or null.
function Packet(link) { this.link = link; this.count = 0; this.mark = 0; this.data = new Array(4); }
Packet.prototype.fill = function (v) {
  for (let i = 0; i < 4; i++) {
    this.mark++;
    if (this.mark > 26) this.mark = 1;
    this.data[i] = v === undefined ? this.mark : v;
  }
};
Packet.prototype.take = function (from) {
  const count = from.count;
  if (count < 4 || count === undefined) {
    this.count = from.data[count];
    from.count = count + 1;
  }
  return this.count;
};
Packet.prototype.at = function (from, key) { this.count = from.data[key]; return this.count; };
class Cell { constructor() { this.value = 0.5; this.list = [1, 2, 3]; } read(from, k) { this.value = from.list[k]; return this.value; } }
const show = v => Object.is(v, -0) ? "-0" : typeof v + " " + String(v);
const zero = process.argv.length > 100 ? 1 : 0;
const first = new Packet(null), second = new Packet(first);
first.fill();
for (let turn = 0; turn < 6; turn++) console.log(show(second.take(first)), show(first.count), show(second.count));
for (const v of [0.5, -0, 2 ** 31, 2 ** 53, 0 / zero, 1 / zero]) { first.fill(v); first.count = 0; console.log(show(second.take(first)), show(second.at(first, 3)), show(second.at(first, 7))); }
for (const key of [0, 1.5, -1, zero - zero, undefined, null, "1", "x", 2 ** 32 - 1, 0 / zero]) console.log(String(key), show(second.at(first, key)));
first.data[2] = undefined; console.log(show(second.at(first, 2)), show(second.take(first)));
first.data = [, 7]; console.log(show(second.at(first, 0)), show(second.at(first, 1)));
first.count = undefined; console.log(show(second.take(first)), show(first.count));
const cell = new Cell(), other = new Cell(); other.list = [0.25, , 3];
for (const k of [0, 1, 2, 3, 0.5, undefined]) console.log(show(cell.read(other, k)), show(cell.value));
