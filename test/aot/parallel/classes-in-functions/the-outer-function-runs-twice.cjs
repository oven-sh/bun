function outer(k) { return (function () { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x + k; }; return Point; })(); }
const A = outer(10), B = outer(20);
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new A(i).get(), new B(i).get()); return out.join(" "); }
console.log(run(3), A === B);
