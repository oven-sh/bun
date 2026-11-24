// A class that has several members of one name: the last method, or the getter and the setter behind it, are what stands on its prototype.
const log = [];
const show = value => (typeof value === "function" ? "function " + value() : value);

class GetterMethod { get m() { return "get"; } m() { return "method"; } }
const stored = new GetterMethod();
const before = { v: stored.m };
stored.m = 1;
console.log(show(before.v), stored.m, Object.hasOwn(stored, "m"), Object.getOwnPropertyNames(GetterMethod.prototype).join());

class GetterMethodSetter { get k() { return "get"; } k() { return "method"; } set k(v) { log.push("k:" + v); } }
const set = new GetterMethodSetter();
const read = { v: set.k };
set.k = "stored";
console.log(read.v, set.k, Object.hasOwn(set, "k"));

class SetterMethod { set n(v) { log.push("never"); } n() { return "method"; } }
const plain = new SetterMethod();
console.log(plain.n());
plain.n = 2;
console.log(plain.n);

class MethodGetter { p() { return "method"; } get p() { return "get"; } }
const getter = new MethodGetter();
try {
  getter.p = 3;
} catch (error) {
  console.log(error.name);
}
console.log(getter.p);

class GetterSetterGetter { get q() { return "first"; } set q(v) { log.push("q:" + v); } get q() { return "second"; } }
const pair = new GetterSetterGetter();
pair.q = 4;
console.log({ v: pair.q }.v);

class MethodMethod { r() { return "first"; } r() { return "second"; } }
console.log(new MethodMethod().r());

class StaticGetterMethod { static get s() { return "get"; } static s() { return "method"; } }
console.log(StaticGetterMethod.s());
StaticGetterMethod.s = 5;
console.log(StaticGetterMethod.s);

class GetterMethodParent { get t() { return "get"; } t() { return "method"; } }
class Below extends GetterMethodParent { up() { return super.t; } }
const below = new Below();
console.log(below.up()(), below.t());
below.t = 6;
console.log(below.t, show(below.up()));
console.log(log.join());
