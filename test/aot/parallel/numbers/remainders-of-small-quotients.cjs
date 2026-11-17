// STATISTIC: RemaindersOfSmallQuotients >= 1
// at = (at + 1) % length in a loop: a quotient of 0 or 1 takes a subtraction.
class Ring {
  constructor(n) {
    this.values = new Array(n).fill(0);
    this.head = 0;
  }
  add(x) {
    this.values[this.head] = x;
    this.head = (this.head + 1) % this.values.length;
  }
  at(k) {
    return this.values[(this.head + k) % this.values.length];
  }
}
function sums(n, m) {
  const ring = new Ring(n);
  let s = 0;
  for (let i = 0; i < m; i++) {
    ring.add(i * 0.5);
    s = s * 0.5 + ring.at(i & 7) + ring.at(i);
  }
  return s;
}
function neighbors(cells) {
  const h = cells.length,
    w = cells[0].length;
  let s = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let d = -1; d <= 1; d++) s = s * 0.75 + cells[(y + d + h) % h][(x + d + w) % w];
    }
  }
  return s;
}
console.log(sums(16, 100), sums(1, 10), sums(3, 50), sums(7, 1000));
console.log(neighbors(Array.from({ length: 6 }, (_, y) => Array.from({ length: 5 }, (_, x) => y * 5 + x))));
const edges = [1, 2, 3, 1073741823, 1073741824, 1073741825, 2147483647, 2147483648, 4294967295, 9007199254740991];
let line = "";
for (const d of edges) {
  for (const x of [0, 1, d - 1, d, d + 1, d * 2 - 1, d * 2, d * 2 + 1, d * 3]) line += (x % d) + " ";
}
console.log(line);
