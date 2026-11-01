// `Object.defineProperty(Point, "of", { value: function .. })`, as Babel's _createClass lays the static methods of a class, and a loop that calls the method right behind the definition.
// The function has been given its first name a moment ago. What the loop asks ahead of its turns is answered all the same, so no turn looks the name up.
// COUNT: arrivals <= 40
function Point(x) {
  this.x = x;
}
Object.defineProperty(Point, "of", {
  value: function of(x) {
    return new Point(x);
  },
  writable: true,
  configurable: true,
});
function turn(i) {
  return Point.of(i & 7).x;
}
function sumOf(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += turn(i);
  return sum;
}
console.log(sumOf(5000), Object.keys(Point).length, Object.getOwnPropertyNames(Point).join());
