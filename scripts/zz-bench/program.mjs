// Temporary: a program to compile ahead of time, which spends its time in the engine's helpers.
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(other) {
    return new Point(this.x + other.x, this.y + other.y);
  }
}
let total = 0;
for (let round = 0; round < 30; round++) {
  const map = new Map();
  let point = new Point(0, 0);
  for (let i = 0; i < 20000; i++) {
    point = point.add(new Point(i & 3, 1));
    map.set("k" + (i % 5000), point);
  }
  const rows = [...map].map(([key, { x, y }]) => ({ key, x, y })).sort((a, b) => a.x - b.x);
  total += JSON.stringify(rows).length + rows.filter(row => /7$/.test(row.key)).length;
}
console.log(total);
