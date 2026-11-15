// Namespaces: an object takes more functions, constructors and values by stores than one set of functions names. Some of them are read by every way that reads all properties at once.
const show = value => typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : typeof value + " " + String(value);
var Lib = {};
if (typeof Lib.math === "undefined") Lib.math = {};
Lib.math.half = function (a) { for (var i = 0; i < 1; i++) a = a * 0.5; return a; };
Lib.math.next = function (a) { for (var i = 0; i < 1; i++) a = a + 1; return a; };
Lib.math.name = function (a) { for (var i = 0; i < 1; i++) a = "n" + a; return a; };
Lib.math.pair = function (a) { var list = []; for (var i = 0; i < 2; i++) list.push(a); return list; };
Lib.math.flag = function (a) { for (var i = 0; i < 1; i++) a = !a; return a; };
Lib.math.none = function () { };
Lib.math.scale = 2;
(function () {
  function V() { V.Vec.apply(this, arguments); this.constructor === V && this.Vec.apply(this, arguments); }
  function W() { W.Wide.apply(this, arguments); this.constructor === W && this.Wide.apply(this, arguments); }
  function X() { this.x = "x"; }
  function Y(y) { this.y = y; }
  function Z() { this.z = []; }
  Lib.math.Vec = V; Lib.math.Wide = W; Lib.math.Ex = X; Lib.math.Why = Y; Lib.math.Zed = Z;
})();
(function () {
  var V = Lib.math.Vec, W = Lib.math.Wide, math = Lib.math;
  V.Vec = function () { };
  V.prototype.Vec = function (x, y) { this.x = x; this.y = y; };
  V.prototype.dot = function (other) { return this.x * other.x + this.y * other.y; };
  W.Wide = function () { this.lower = new V(0, 0); };
  W.prototype.Wide = function (w) { this.upper = new V(w, math.half(w)); };
  W.prototype.area = function () { return (this.upper.x - this.lower.x) * (this.upper.y - this.lower.y); };
})();
function run(count) {
  var V = Lib.math.Vec, sum = 0;
  for (var i = 0; i < count; i++) {
    var v = new V(i, 0.5), w = new Lib.math.Wide(i);
    sum += v.dot(w.upper) + w.area() + Lib.math.half(Lib.math.next(i)) * Lib.math.scale;
  }
  return sum;
}
console.log(run(10), run(100), Lib.math.name(1), show(Lib.math.pair(2)), Lib.math.flag(0), show(Lib.math.none()), show(new Lib.math.Why(-0).y), show(new Lib.math.Zed().z));

// Ways that read every property of a namespace.
var Other = {};
Other.one = function (a) { return a + 1; };
Other.two = function (a) { return this === Other ? a + 2 : "this"; };
Other.three = function (a) { for (var i = 0; i < 3; i++) a += i; return a; };
Other.four = function () { return arguments.length; };
Other.five = function (a) { return Other.one(a) + Other.two(a); };
Other.six = class { constructor(a) { this.a = a; } twice() { return this.a + this.a; } };
Other.value = 0.5;
function call(count) { var sum = 0; for (var i = 0; i < count; i++) sum += Other.one(i) + Other.two(i) + Other.three(i) + Other.four(i, i) + Other.five(i) + new Other.six(i).twice() + Other.value; return sum; }
console.log(call(20));
for (var key in Other) console.log(key, show(Other[key]), key === "six" ? "" : show(typeof Other[key] === "function" ? Other[key](1) : Other[key]));
var copied = Object.assign({}, Other), spread = { ...Other, seven: 7 };
console.log(copied.one(1), copied.two(1), spread.two(1), spread.five(1), Object.keys(spread).join());
var { one, five, ...rest } = Other;
console.log(one(2), five(2), Object.keys(rest).join(), rest.three(1));
console.log(Object.values(Other).map(value => typeof value).join(), Object.entries(Other).length, JSON.stringify(Other));
(function change(target, names) { for (const name of names) target[name] = function (a) { return name + a; }; })(Other, ["one", "three", "eight"]);
console.log(Other.one(1), Other.three(2), Other.eight(3), copied.one(1), call(2));
Other["f" + "ive"] = a => -a;
console.log(show(Other.five(0)), Reflect.ownKeys(Other).length);
Object.defineProperty(Other, "two", { get() { return () => "getter"; }, configurable: true, enumerable: true });
console.log(Other.two(1), spread.two(1));
delete Other.two;
try { console.log(call(1)); } catch (error) { console.log(error.constructor.name); }
Other.two = (a, b) => [a, b].length;
console.log(call(3), show(globalThis.structuredClone ? structuredClone({ a: Other.value }) : { a: 0.5 }));
