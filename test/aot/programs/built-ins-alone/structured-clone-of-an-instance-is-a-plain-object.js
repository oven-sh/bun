class Point {
  x = 1.5;
  double() {
    return this.x * 2;
  }
}
const copy = structuredClone(new Point());
console.log(copy.x + 1, copy instanceof Point, typeof copy.double, Object.getPrototypeOf(copy) === Object.prototype);
