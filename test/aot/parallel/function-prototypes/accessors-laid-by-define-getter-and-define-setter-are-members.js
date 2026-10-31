// `B.prototype.__defineSetter__("a", ..)` and `__defineGetter__`, on a class and on a constructor function: the statement names the prototype object as plainly as Object.defineProperty(B.prototype, ..) does, so the accessors are members: the constructor's store runs the setter and the read runs the getter, neither by name.
// COUNT: arrivals <= 20
let seen = 0;
class B {
  constructor(a) {
    this.a = a;
    this.b = 2;
  }
}
B.prototype.__defineSetter__("a", function (value) { seen += value; });
B.prototype.__defineGetter__("a", function () { return 1; });
function F(a) {
  this.a = a;
  this.b = 3;
}
F.prototype.__defineGetter__("a", function () { return 2; });
F.prototype.__defineSetter__("a", function (value) { seen -= 2 * value; });
function turn(i) {
  const v = new B(i & 7);
  const w = new F(i & 3);
  return v.a + v.b + w.a + w.b;
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum += turn(i);
const described = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(new B(1)), "a");
console.log(sum, seen, Object.keys(new B(1)).join(), Object.keys(new F(1)).join(), described.enumerable, described.configurable, typeof described.get, typeof described.set);
console.log(typeof B.prototype.__lookupGetter__("a"), typeof new F(1).__lookupSetter__("a"), B.prototype.__lookupGetter__("b"));
