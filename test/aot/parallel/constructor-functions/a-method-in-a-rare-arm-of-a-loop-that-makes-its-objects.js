// The calls in an arm that some iterations take find what stands above the object then.
const data = JSON.parse("[0, 3, 5]");
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.sum = function () {
  return this.x + this.y;
};
if (data[0]) Point.prototype.debug = () => -1;
function run(count, at, lay) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    const point = new Point(i & 7, 2);
    total += point.sum() + point.x;
    if (i % 8 === at) lay(i);
    if (i % 4 === 1) total += point.debug ? point.debug() : 100;
    if (i > count - 3) total += point.sum();
  }
  return total;
}
console.log(run(40, 9, () => {}));
console.log(run(40, data[1], i => { if (i === 11) Point.prototype.debug = function () { return this.x; }; }));
console.log(run(40, data[2], i => { if (i === 13) Point.prototype.sum = () => 1000; }));
console.log(run(40, data[2], i => { if (i === 21) delete Point.prototype.debug; }));
console.log(run(40, 2, i => { Object.defineProperty(Point.prototype, "debug", { get: () => () => i, configurable: true }); }));
