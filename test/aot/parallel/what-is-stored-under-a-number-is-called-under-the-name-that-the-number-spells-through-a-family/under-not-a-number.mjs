class Base {
  constructor(n) {
    this.n = n;
  }
}
class A extends Base { a() { return "a" + this.n; } }
class B extends Base { b() { return "b" + this.n; } }
class C extends Base { c() { return "c" + this.n; } }
class D extends Base { d() { return "d" + this.n; } }
class E extends Base { e() { return "e" + this.n; } }
class F extends Base { f() { return "f" + this.n; } }
class G extends Base { g() { return "g" + this.n; } }
const list = [new Base(0), new A(1), new B(2), new C(3), new D(4), new E(5), new F(6), new G(7)];
const late = process.argv.length > 99;
const key = late ? 7 : NaN;
const one = new A(8);
one[key] = v => "laid" + (v + 1);
list.push(one);
console.log("SAID s0", list.map(x => (x.NaN ? x.NaN(4) : "none")).join());
