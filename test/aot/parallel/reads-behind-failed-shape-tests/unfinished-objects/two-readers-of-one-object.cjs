const log = [];
function f(x) { let s = "" + x.a; if (typeof x !== "number") s += "/" + x.a; return s; }
function A(v) { this.a = v; log.push(f(this)); this.z = 1; }
class B { constructor(v) { this.b = v; } }
class C { constructor(v) { this.c = v; } }
for (const v of [f(new A(1)), f(new B(2)), f(new C(3)), f(4)]) log.push(v);
console.log(log.join(" "));
