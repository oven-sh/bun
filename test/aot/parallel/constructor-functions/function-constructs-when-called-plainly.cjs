// Functions of code that is not strict ask `this instanceof` themselves and construct themselves otherwise: called plainly, by
// `new`, with a receiver of every kind, as methods, bound, and by built-ins. Nothing of what they store reaches the global object.
function Point(x, y) {
  if (!(this instanceof Point)) return new Point(x, y);
  this.x = x;
  this.y = y;
}
Point.prototype.sum = function () {
  return this.x + this.y;
};
var holder = { Point };
var made = [
  Point(1, 2),
  new Point(3, 4),
  Point.call(undefined, 5, 6),
  Point.call(null, 7, 8),
  Point.call(9, 10, 11),
  Point.call("text", 12, 13),
  Point.call({}, 14, 15),
  holder.Point(16, 17),
  Point.bind(undefined)(18, 19),
  Point.bind(holder)(20, 21),
  Reflect.apply(Point, undefined, [22, 23]),
  (0, Point)(24, 25),
  [26].map(Point)[0],
];
for (var point of made) console.log(point instanceof Point, point.sum(), JSON.stringify(point));
var reused = new Point(0, 0);
console.log(Point.call(reused, 27, 28), reused.sum());
console.log(typeof x, typeof y, "x" in holder, Object.keys(globalThis).includes("x"));
