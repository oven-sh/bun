const unseen = (x) => [x][JSON.parse("0")];
const above = {
  set(key, value) { return Map.prototype.set.call(this, key, "above:" + value); },
  get: Map.prototype.get,
};
class Table {
  constructor(parent) {
    const table = new Map();
    Object.setPrototypeOf(table, parent);
    return table;
  }
}
function gather(n, change) {
  const result = new Table(above);
  for (let k = 0; k < n; k++) result.set(k, change(k));
  return result;
}
const changes = [(k) => k, (k) => k * 2];
const lines = [];
for (let round = 0; round < 12; round++) lines.push(round + " " + unseen(gather(4, changes[round % 2])).get(3));
console.log(lines.join("\n"));
