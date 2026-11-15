class Point {
  constructor(x) {
    this.x = x;
  }
  get double() {
    return this.x * 2;
  }
}
function sum(list) {
  let total = 0;
  for (const point of list) total += point.double;
  return total;
}
const points = [1, 2, 3].map(x => new Point(x));
console.log(sum(points), Buffer.from("x").length);
setTimeout(() => console.log("later"), 0);
Array.prototype.push = function () {};
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
