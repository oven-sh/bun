var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
globalThis.runsOfTheBundle = (globalThis.runsOfTheBundle || 0) + 1;
var Point, made, run;
var initPoint = __esm(() => {
    made = 0;
    run = globalThis.runsOfTheBundle;
    Point = class Point { constructor(x) { this.x = x; made++; } sum() { return this.x + run * 100; } };
});
initPoint();
const make = x => new Point(x), count = () => made;
export { Point, make, count, run };
