class A { constructor(x) { this.x = x; } }
class Other { constructor(x, y) { this.x = -x; this.y = y; } }
function Plain(x) { this.x = x * 100; }
class B extends A { k() { return this.x; } }
globalThis.kept = { A, B, Other, Plain };
const change = (0, eval)("(function (to) { Object.setPrototypeOf(kept.B, to); })");
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new B(i, 1).k(); return t; }
console.log(run(20000));
change(Other); console.log(run(20000), new B(1, 2).y, new B(1) instanceof A, new B(1) instanceof Other);
change(Plain); console.log(run(20000), new B(3).x);
change(A); console.log(run(20000));
change(function () { return { k() { return 9; } }; }); console.log(run(100));
for (const bad of [null, {}, () => 1, Math.max, Object.create(A)]) { try { change(bad); console.log(run(3)); } catch (e) { console.log(e.constructor.name); } }
change(A); console.log(run(20000));
