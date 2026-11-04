function make(k) { return class Point { constructor(x) { this.x = x; } get() { return this.x * k; } static tag = k; }; }
const A = make(2), B = make(3);
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new A(i).get(), new B(i).get()); return out.join(" "); }
console.log(run(3), A.tag, B.tag, new A(1) instanceof B);
