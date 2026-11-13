// A product whose remainder is expected behind a test of the curve's shape: where the curve has another shape, the product is handed to the whole function.
const library = (function (exports) {
  "use strict";
  let CURVE = Object.freeze({ a: BigInt(-1), P: BigInt("57896044618658097711785492504343953926634992332820282019728792003956564819949"), h: BigInt(8) });
  exports.CURVE = CURVE;
  const _0n = BigInt(0);
  function mod(a, b = CURVE.P) {
    const res = a % b;
    return res >= _0n ? res : b + res;
  }
  class Point {
    constructor(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    add(other) {
      const { x: X1, y: Y1, z: Z1 } = this;
      const { x: X2, y: Y2, z: Z2 } = other;
      const A = mod((Y1 - X1) * (Y2 + X2));
      const B = mod((Y1 + X1) * (Y2 - X2));
      const C = mod(Z1 * Z2);
      const D = mod(A - B);
      return new Point(mod(A * D), mod(B * C), mod(C * D));
    }
    toString() {
      return [this.x, this.y, this.z].map(value => value.toString(16)).join(" ");
    }
  }
  exports.Point = Point;
  exports.mod = mod;
  exports.replace = curve => { CURVE = curve; };
  return exports;
})({});
const P = library.CURVE.P;
function walk(turns) {
  let point = new library.Point(P / 3n, P / 5n, P / 7n);
  const base = new library.Point(P - 11n, P / 13n, P - 17n);
  for (let i = 0; i < turns; i++) point = point.add(base);
  return String(point);
}
console.log(walk(200));
for (const curve of [{ P }, { z: 1n, P: 2n ** 256n - 189n }, { get P() { return 2n ** 521n - 1n; } }, Object.create({ P: 1000003n }), { P: 7n, a: 1n, h: 2n }, { h: 1, P: "12" }, {}, null]) {
  library.replace(curve);
  try { console.log(walk(40)); } catch (error) { console.log(error.name); }
  for (const [x, y] of [[1n, 2], [3, 4n], [5n, 6n], [7, 8], ["9", 10n], [undefined, 11n]]) {
    try { console.log(String(new library.Point(x, y, x).add(new library.Point(y, x, y)))); } catch (error) { console.log(error.name, error.message.slice(0, 20)); }
  }
}
library.replace(library.CURVE);
console.log(walk(100));
