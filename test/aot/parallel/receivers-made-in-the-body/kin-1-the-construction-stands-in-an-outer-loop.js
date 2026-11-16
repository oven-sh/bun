const unseen = (x) => [x][JSON.parse("0")];
const above = {
  push(value) { this[this.length] = "above:" + value; return this.length; },
  join: Array.prototype.join,
};
class Shelf {
  constructor(parent) {
    const list = [];
    Object.setPrototypeOf(list, parent);
    return list;
  }
}
function gather(n, change) {
  let result = null;
  for (let turn = 0; turn < 2; turn++) {
    const made = new Shelf(above);
    for (let k = 0; k < n; k++) made.push(change(k));
    result = made;
  }
  return result;
}
const changes = [(k) => k, (k) => k * 2];
const lines = [];
for (let round = 0; round < 12; round++) lines.push(round + " " + unseen(gather(4, changes[round % 2])).join(","));
console.log(lines.join("\n"));
