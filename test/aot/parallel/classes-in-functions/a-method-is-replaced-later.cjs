var Point = (function () { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x; }; return Point; })();
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) Point.prototype.get = function () { return -this.x; }; out.push(new Point(i).get()); } return out.join(" "); }
console.log(run(4));
