const again = (0, eval)("(f) => [f(), f()]");
function make() { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x; }; return Point; }
const first = make();
const [A, B] = again(make);
A.prototype.get = function () { return "A" + this.x; };
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new first(i).get(), new A(i).get(), new B(i).get()); return out.join(" "); }
console.log(run(2), A === B, first === A);
