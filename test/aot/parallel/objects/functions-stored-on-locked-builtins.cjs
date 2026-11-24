const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
};
function Point(x) {
  this.x = x;
}
Point.prototype.read = function () {
  return this.x;
};
const run = (point, count) => {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += point.read();
  return sum;
};
tell(run(new Point(0.5), 10), run(new Point(2), 1000));

// What is stored under names that nobody locks is called as before.
const own = {};
const stored = [];
own.defineProperty = function (point) {
  stored.push(point.read());
  point.x = 7;
  return point;
};
const heir = Object.create(Object);
heir.keys = function (point) {
  point.x = "text";
  return point.read();
};
tell(own.defineProperty(new Point(3)).x, heir.keys(new Point(1)), stored.join());
tell(Object.keys({ a: 1 }).join(), Object.hasOwn(heir, "keys"), Object.getPrototypeOf(heir) === Object);

globalThis.laidAnew = function (point) {
  point.x = -1;
  return point.read();
};
tell(laidAnew(new Point(5)), run(new Point(1.5), 4));
console.log.held = function (point) {
  return point.read() + 1;
};
tell(attempt(() => console.log.held(new Point(4))));
tell(run({ read: () => 1 }, 3));
console.log(lines.join("\n"));
