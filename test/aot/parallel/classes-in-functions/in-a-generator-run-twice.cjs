function* makes() { for (;;) { class Point { constructor(x) { this.x = x; } get() { return this.x; } } yield Point; } }
const it = makes(), A = it.next().value, B = it.next().value;
B.prototype.get = function () { return -this.x; };
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new A(i).get(), new B(i).get()); return out.join(" "); }
console.log(run(3), A === B);
