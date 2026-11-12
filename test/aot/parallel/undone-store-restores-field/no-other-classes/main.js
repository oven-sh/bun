// Only Counter and the literal have a field list.
function veil(value) {
  return JSON.parse("0", () => value);
}
class Counter {
  constructor(list) {
    this.list = list;
    this.n = 0;
    this.sum = 0;
  }
}
function tally(o) {
  for (let j = 0; j < 3; j++) o.sum += 0.5;
  for (let i = 0; i < 8; i++) {
    o.n = (o.n + 1) | 0;
    o.sum = (o.sum * 31 + o.list[i >> 1]) | 0;
  }
  return o.sum + "/" + o.n;
}
const rows = [];
for (const r of rows) console.log(typeof new Counter(r));
console.log(tally(veil({ list: [1, 2, 3, 4], n: 0.5, sum: 1, last: 0 })));
