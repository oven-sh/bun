const unseen = (x) => [x][JSON.parse("0")];
const kept = { last: null };
class Shelf {
  constructor(box) {
    const list = [];
    box.last = list;
    return list;
  }
}
function gather(n, change) {
  const result = new Shelf(kept);
  for (let k = 0; k < n; k++) result.push(change(k));
  return result;
}
function lays(k) {
  if (k === 2) kept.last.push = function (value) { return Array.prototype.push.call(this, "own:" + value); };
  return k;
}
const changes = [lays, (k) => k * 2];
const lines = [];
for (let round = 0; round < 12; round++) lines.push(round + " " + unseen(gather(5, changes[round % 2])).join(","));
console.log(lines.join("\n"));
