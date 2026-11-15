function Point(x) { this.x = x; }
Point.prototype.name = function () { return "old"; };
function swap(i) { if (i === 2) Point.prototype = { name() { return "new"; } }; return i; }
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new Point(swap(i)).name()); return out.join(" "); }
console.log(run(5));
