// What a callback of map, forEach, reduce and the like calls is called in a loop: its BigInts may be at places of its frame.
const P = (1n << 255n) - 19n;
function mod(a, m = P) {
  const r = a % m;
  return r >= 0n ? r : m + r;
}
class Point {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  toAffine(inverse = 3n) {
    const { x, y, z } = this;
    const ax = mod(x * inverse), ay = mod(y * inverse), zz = mod(z * inverse);
    if (zz === 5n) throw new Error("five " + ax);
    return new Point(ax, ay, zz);
  }
  static copy(p) {
    return new Point(p.x, p.y, mod(p.x * p.y));
  }
  shift(by) {
    let kept = this.x, list = [];
    for (let i = 0n; i < by; i++) {
      kept = mod(kept * kept - i);
      list.push(() => kept);
    }
    return [kept, list.map((f) => f())[0]];
  }
}
function product(list, m) {
  return list.reduce((all, value) => mod(all * value, m), 1n);
}
const make = (n) => Array.from({ length: n }, (_, i) => new Point(BigInt(i) * 12345678901234567890123456789n - 7n, (1n << BigInt(i * 9 % 300)) - 3n, BigInt(i + 2)));
for (const list of [make(0), make(1), make(40)]) {
  const affine = list.map((p, i) => p.toAffine(BigInt(i) + 1n));
  console.log(affine.map((p) => p.x ^ p.y).join(), product(list.map((p) => p.x), P), product(list.map((p) => p.y), (1n << 61n) - 1n));
  console.log(affine.map(Point.copy).map((p) => p.z).join());
  list.forEach((p) => console.log(p.shift(3n).join()));
  console.log(list.some((p) => p.toAffine(2n).z === 8n), list.every((p) => p.toAffine().x >= 0n), list.filter((p) => p.toAffine(7n).z % 2n).length);
}
try {
  make(9).map((p) => p.toAffine(1n));
} catch (error) {
  console.log(error.message);
}
console.log([1n, 2, 3n].map((v) => { try { return mod(v); } catch (error) { return error.name; } }).join());
