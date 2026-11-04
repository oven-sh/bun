function inner(a, b, c) { return [a, b, c, arguments.length].join(); }
class Point { constructor(x, y) { this.x = x; this.y = y; this.count = arguments.length; } }
for (let i = 0; i < 3; i++) {
  const list = [i, 2];
  const p = new Point(...[i, 5]);
  const q = new Point(...list, 7);
  list.push(9);
  const r = new Point(...list);
  console.log(inner(...[i, 1]), inner(...[i, , 1]), inner(...[]), inner(...[i], ...[2, 3]), inner(...list), JSON.stringify([p, q, r]));
}
