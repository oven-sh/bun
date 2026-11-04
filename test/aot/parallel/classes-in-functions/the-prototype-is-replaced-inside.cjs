var Point = (function () { function Point(x) { this.x = x; } Point.prototype = { get() { return this.x; }, constructor: Point }; return Point; })();
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Point(i).get(); return t; }
console.log(run(4), Object.keys(Point.prototype).join(), new Point(1).constructor === Point);
