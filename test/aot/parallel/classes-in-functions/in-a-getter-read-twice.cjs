const holder = { get Point() { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x; }; return Point; } };
const A = holder.Point, B = holder.Point;
B.prototype.get = function () { return -this.x; };
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new A(i).get(), new B(i).get()); return out.join(" "); }
console.log(run(3), A === B);
