var Point;
if (process.argv.length > 0) Point = (function () { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x; }; return Point; })();
else Point = (function () { function Point(x) { this.y = x; } Point.prototype.get = function () { return -this.y; }; return Point; })();
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Point(i).get(); return t; }
console.log(run(4), Object.keys(new Point(1)).join());
