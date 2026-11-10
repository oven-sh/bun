import "./lib-readers-in-a-file-that-writes-none-of-the-names.js";
const measureElsewhere = globalThis.readersElsewhere.measure;
const truthElsewhere = globalThis.readersElsewhere.truth;
class Shelf {
  constructor(depth) {
    this.rows = 2;
    if (depth !== undefined) this.depth = depth;
  }
}
Shelf.prototype.depth = "above";
function measure(shelf) {
  return shelf.depth;
}
function truth(shelf) {
  return shelf.depth ? "yes" : "no";
}
const shelves = [new Shelf(4), new Shelf(), new Shelf(0), new Shelf(), new Shelf("deep"), new Shelf(null)];
globalThis.shelves = shelves;
let out = "";
for (let turn = 0; turn < 600; turn++) {
  const list = globalThis.shelves;
  for (let at = 0; at < list.length; at++) {
    const depth = measure(list[at]);
    const asked = truth(list[at]);
    if (measureElsewhere(list[at]) !== depth || truthElsewhere(list[at]) !== asked) out += "ELSEWHERE " + turn + " " + at + " " + String(measureElsewhere(list[at])) + ",";
    if (turn % 150 === 149) out += String(depth) + ":" + asked + ",";
  }
  if (turn === 300) Shelf.prototype.depth = "moved";
  if (turn === 450) delete Shelf.prototype.depth;
  if (turn % 150 === 149) out += ";";
}
console.log(out);
