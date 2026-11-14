// Loops make objects of a constructor function, call its methods and read a list of any kind. The prototype changes in front of the loop, or a getter of the list changes it in the loop.
function Point(x, y) { this.x = x; this.y = y; }
const sum = function () { return this.x + this.y; }, twice = function () { return this.x * 2; };
function reset() { Point.prototype = { constructor: Point }; Object.setPrototypeOf(Point.prototype, Object.prototype); Point.prototype.sum = sum; Point.prototype.twice = twice; }
Point.prototype.sum = sum;
Point.prototype.twice = twice;

function fromElements(list, n) { let total = 0; for (let i = 0; i < n; i++) { const point = new Point(list[i % 3], 2); total += point.sum(); } return total; }
function flagged(list, n) { let total = 0; for (let i = 0; i < n; i++) { const point = new Point(i & 1023, 2); total += point.sum() + point.x; if (list[0]) total += point.twice(); } return total; }
function scaled(list, n) { let total = 0; for (let i = 0; i < n; i++) { const point = new Point(i, 1); total += point.sum() * list[i & 1]; } return total; }
function byLength(list, n) { let total = 0; for (let i = 0; i < n && i < list.length; i++) { const point = new Point(list[i], i); total += point.sum(); } return total; }
function readFirst(list, n) { let total = 0; for (let i = 0; i < n; i++) { const factor = list[1]; const point = new Point(i, 3); total += point.twice() - factor; } return total; }
function grows(list, n) { let total = 0; for (let i = 0; i < n; i++) { const point = new Point(i, 2); if (Array.isArray(list) && list.length < 8) list.push(point.sum()); total += list[0]; } return total; }
function kept(list, n) { const points = []; for (let i = 0; i < n; i++) { const point = new Point(list[i & 3], i); if (i === 3) points.push(point); points.push(point.sum()); } return points.map(p => typeof p === "object" ? "point " + String(p.x) : p); }
function nested(list, n) { let total = 0; for (let i = 0; i < 2; i++) for (let j = 0; j < n; j++) { const point = new Point(list[j % 2], i); total += point.sum(); } return total; }
function caught(list, n) { let total = 0; for (let i = 0; i < n; i++) { try { const point = new Point(list[i & 1], 2); total += point.sum(); } catch (e) { total += 1000; } } return total; }
function twoLists(list, n, other) { let total = 0; for (let i = 0; i < n; i++) { const point = new Point(list[0], other[1]); total += point.sum(); } return total; }

const kinds = [
  () => [1, 2, 3, 4], () => [0.5, 1.5, -0], () => ["a", "b", "c"], () => [1, , 3], () => [], () => [undefined, null, true], () => [1n, 2n, 3n], () => new Uint8Array([1, 2, 3]), () => new Float64Array([0.5, 2]), () => "text",
  () => ({ 0: 5, 1: 6, length: 2 }), () => ({ get 0() { return 7; }, get 1() { return 8; } }), () => new Proxy([1, 2, 3], { get(target, key) { return Reflect.get(target, key); } }), () => (function () { return arguments; })(4, 5), () => Object.assign([9, 8], { extra: 1 }),
  () => Object.setPrototypeOf([3], { 1: 30, 2: 40 }), () => 5, () => null, () => undefined, () => [{ valueOf: () => 4 }, "2"], () => new Map([[0, 1]]),
];
const changesInLoop = [
  () => Object.defineProperty([1, 2, 3], 1, { get() { Point.prototype.sum = function () { return 100; }; return 2; } }),
  () => Object.defineProperty([1, 2, 3], 0, { get() { delete Point.prototype.twice; Point.prototype.twice = function () { return -1; }; return 1; } }),
  () => new Proxy([1, 2, 3], { get(target, key) { if (key === "1") Point.prototype = { sum() { return 7; }, twice() { return 8; } }; return Reflect.get(target, key); } }),
  () => ({ get 0() { Object.defineProperty(Point.prototype, "sum", { get() { return () => 55; }, configurable: true }); return 1; }, 1: 2, 2: 3 }),
];
const changesInFront = [
  () => { Point.prototype.sum = function () { return this.x - this.y; }; },
  () => { delete Point.prototype.twice; },
  () => { Point.prototype = { sum() { return 11; }, twice() { return 12; } }; },
  () => { Point.prototype.sum = 5; },
  () => { Object.defineProperty(Point.prototype, "twice", { get() { return function () { return this.y; }; }, configurable: true }); },
  () => { Object.setPrototypeOf(Point.prototype, { late() { return 1; } }); },
];
const show = value => Array.isArray(value) ? "[" + value.map(show).join(" ") + "]" : Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value).slice(0, 30);
const loops = [fromElements, flagged, scaled, byLength, readFirst, grows, kept, nested, caught, twoLists];
function attempt(loop, make, n) { try { return show(loop(make(), n, make())); } catch (e) { return e.name; } }
for (const loop of loops) {
  for (const n of [0, 1, 5, 40]) console.log(loop.name, n, kinds.map(make => attempt(loop, make, n)).join(" "));
  console.log(loop.name, "in the loop", changesInLoop.map(make => { const said = attempt(loop, make, 6); reset(); return said; }).join(" "));
  console.log(loop.name, "in front", changesInFront.map(change => { change(); const said = attempt(loop, () => [1, 2, 3], 6) + "/" + attempt(loop, () => new Float64Array([1, 2, 3]), 6); reset(); return said; }).join(" "));
}
