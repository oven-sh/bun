// The same for a class and its heir, one name at a time, with a name that the accessor captured.
// COUNT: arrivals <= 200
"use strict";
const alias = name => ({
  configurable: true,
  get() {
    return this[name];
  },
  set(value) {
    this[name] = value;
  },
});
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
Object.defineProperty(Point.prototype, "left", alias("x"));
Object.defineProperty(Point.prototype, "top", alias("y"));
class Pixel extends Point {
  color = 7;
}

function move(points) {
  let sum = 0;
  for (const point of points) {
    point.top = (point.left + point.top) & 1023;
    sum += point.left + point.top;
  }
  return sum;
}
const points = [];
for (let i = 0; i < 64; i++) points.push(i & 1 ? new Point(i, 1) : new Pixel(i, 2));
let sum = 0;
for (let turn = 0; turn < 1000; turn++) sum += move(points);
console.log(sum);
