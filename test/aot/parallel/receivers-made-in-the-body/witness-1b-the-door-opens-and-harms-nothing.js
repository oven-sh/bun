const unseen = (x) => [x][JSON.parse("0")];
class Shelf {
  constructor() {
    const list = [];
    return list;
  }
}
function gather(n, change) {
  const result = new Shelf();
  for (let k = 0; k < n; k++) result.push(change(k));
  return result;
}
const changes = [(k) => k, (k) => k * 2];
const lines = [];
for (let round = 0; round < 12; round++) lines.push(round + " " + unseen(gather(4, changes[round % 2])).join(","));
console.log(lines.join("\n"));
