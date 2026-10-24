class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
let reads = 0;
exports.Point = Point;
exports.make = x => new Point(x, 0);
exports.counter = 0;
exports.later = undefined;
exports.bump = () => ++exports.counter;
exports.replaced = () => "first";
exports.replaced = () => "second";
Object.defineProperty(exports, "viaGetter", { enumerable: true, get: () => ++reads });
Object.defineProperty(exports, "hidden", { enumerable: false, value: 1 });
setTimeout(() => {
  exports.later = () => 1;
});
