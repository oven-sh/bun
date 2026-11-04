var lib = (function () { var inner = (function () { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x; }; return Point; })(); return { Point: inner }; })();
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new lib.Point(i).get(); return t; }
console.log(run(4));
