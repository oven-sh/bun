// A member that Object.defineProperty lays on a function, read in a loop right behind the definition, then replaced by a store, redefined as a value, as a getter, and deleted. Each loop sees what is there when it runs.
function Point(x) {
  this.x = x;
}
function increment(a) {
  return a + 1;
}
function define(holder, name, value) {
  Object.defineProperty(holder, name, { value, writable: true, configurable: true });
}
function sumOfPoints(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += Point.of(i & 7).x;
  return sum;
}
function sumOfOthers(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += increment.other(i & 7);
  return sum;
}
define(Point, "of", x => new Point(x));
define(increment, "other", increment);
console.log(sumOfPoints(300), sumOfOthers(300));
Point.of = x => ({ x: x + 2 });
increment.other = a => a + 2;
console.log(sumOfPoints(300), sumOfOthers(300));
define(Point, "of", x => new Point(x + 3));
define(increment, "other", a => a + 3);
console.log(sumOfPoints(300), sumOfOthers(300));
let asked = 0;
Object.defineProperty(Point, "of", { get: () => (asked++, x => new Point(x + 4)), configurable: true });
Object.defineProperty(increment, "other", { get: () => (asked++, a => a + 4), configurable: true });
console.log(sumOfPoints(300), sumOfOthers(300), asked);
delete Point.of;
delete increment.other;
for (const loop of [sumOfPoints, sumOfOthers]) {
  try {
    loop(1);
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
Object.setPrototypeOf(Point, { of: x => ({ x: x + 5 }) });
Object.setPrototypeOf(increment, { other: a => a + 5 });
console.log(sumOfPoints(300), sumOfOthers(300));
