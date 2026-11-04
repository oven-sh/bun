function Holder() { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x; }; this.Point = Point; }
const one = new Holder(), two = new Holder();
two.Point.prototype.get = function () { return -this.x; };
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new one.Point(i).get(), new two.Point(i).get()); return out.join(" "); }
console.log(run(3), one.Point === two.Point);
