// apply, bind, toString and instanceof on functions that have their `prototype` property, before and after each gets a property of that name.
const log = [];
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.sum = function () { return this.x + this.y; };
function Point3(x, y, z) {
  Point.apply(this, [x, y]);
  this.z = z;
}
Point3.prototype = Object.create(Point.prototype, { constructor: { value: Point3, writable: true, configurable: true } });
let p;
let hits = 0;
for (let i = 0; i < 40; i++) {
  p = new Point3(i, 1, 2);
  if (p instanceof Point) hits++;
  if (p instanceof Point3) hits++;
}
log.push(p.sum(), hits, typeof Point.bind(null, 1), Point.bind(null, 1).name, Point.toString().length > 10, Point.length, Point.name);
Object.defineProperty(Point, Symbol.hasInstance, { value(v) { log.push("own hasInstance"); return false; }, configurable: true });
log.push(p instanceof Point, p instanceof Point3);
Point.apply = function (self, list) { log.push("own apply " + list.join()); self.x = -1; self.y = -1; };
p = new Point3(5, 6, 7);
log.push(p.sum());
Point.bind = () => "own bind";
log.push(Point.bind(null, 1));
Point3.prototype = { other: true };
p = new Point3(8, 9, 10);
log.push(Object.getPrototypeOf(p).other, p instanceof Point3, p.z);
console.log(log.join(" | "));
