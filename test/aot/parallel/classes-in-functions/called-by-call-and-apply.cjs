function make() { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x; }; return Point; }
const A = make.call(null), B = make.apply(null, []);
B.prototype.get = function () { return -this.x; };
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new A(i).get(), new B(i).get()); return out.join(" "); }
console.log(run(3), A === B);
