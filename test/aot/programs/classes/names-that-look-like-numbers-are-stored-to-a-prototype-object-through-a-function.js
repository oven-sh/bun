class Base {}
class A extends Base { m() { return 1; } }
function put(p, k, v) { p[k] = v; }
put(A.prototype, "-2", 4); put(A.prototype, "-0", 5); put(A.prototype, "1e3", 6); put(A.prototype, "4294967295", 7); put(A.prototype, "4294967294", 8);
const a = new A();
console.log("instance", a["-2"], a["-0"], a["1e3"], a["4294967295"], a[4294967295], a["4294967294"], a[4294967294], Reflect.ownKeys(A.prototype).join());
class B extends A {} const b = new B(); console.log("below", b["-2"], b[4294967294]);
