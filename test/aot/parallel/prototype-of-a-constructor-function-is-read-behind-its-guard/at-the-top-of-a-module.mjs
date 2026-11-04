function Point(x) { this.x = x; }
Point.prototype.name = function () { return "old"; };
const out = [];
for (let i = 0; i < 5; i++) { if (i === 3) Point.prototype = { name() { return "new"; } }; out.push(new Point(i).name()); }
console.log(out.join(" "));
