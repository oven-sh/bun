// Constructors and functions that pass `arguments` on by several calls of apply(), as a compiler to JavaScript writes classes. One of the calls may reach another `apply`, which changes the arguments object.
const show = value => typeof value === "object" && value !== null ? "{" + Object.keys(value).map(key => key + ":" + show(value[key])).join() + "}" : Object.is(value, -0) ? "-0" : typeof value + " " + String(value);
var Lib = {};
Lib.math = {};
(function () {
  function V() { V.Vec.apply(this, arguments); this.constructor === V && this.Vec.apply(this, arguments); }
  function M() { M.Mat.apply(this, arguments); this.constructor === M && this.Mat.apply(this, arguments); }
  Lib.math.Vec = V; Lib.math.Mat = M;
})();
(function () {
  var V = Lib.math.Vec, M = Lib.math.Mat;
  V.Vec = function () { };
  V.prototype.Vec = function (x, y) { if (x === undefined) x = 0; if (y === undefined) y = 0; this.x = x; this.y = y; };
  V.prototype.add = function (other) { this.x += other.x; this.y += other.y; };
  M.Mat = function () { this.first = new V; this.second = new V; };
  M.prototype.Mat = function (angle, name) { this.first.x = Math.cos(angle); this.second.y = -angle; this.name = name; };
  M.prototype.times = function (v) { return new V(this.first.x * v.x + this.second.x * v.y, this.first.y * v.x + this.second.y * v.y); };
})();
function run(count) {
  var V = Lib.math.Vec, M = Lib.math.Mat, start = new V(1, 2), matrix = new M(0, "m"), sum = 0;
  for (var i = 0; i < count; i++) {
    var v = new V(i, 0.5);
    v.add(start);
    var turned = matrix.times(v);
    sum += turned.x - turned.y;
  }
  return sum;
}
console.log(run(100), show(new Lib.math.Vec(1)), show(new Lib.math.Vec), show(new Lib.math.Mat(-0, "n")), show(new Lib.math.Vec(NaN, -0, 3)));

// The object is of another class, and the test of the constructor does not hold.
function Below() { Lib.math.Vec.apply(this, arguments); }
Below.prototype = Object.create(Lib.math.Vec.prototype);
console.log(show(new Below(1, 2)));
Below.prototype.constructor = Below;
console.log(show(new Below(3, 4)), show((() => { var o = Object.create({ constructor: Lib.math.Vec, Vec(a) { this.own = a; } }); Lib.math.Vec.call(o, 7); return o; })()));

// The first call hands the arguments object to code that changes it.
function Point() { Point.fill.apply(this, arguments); this.init.apply(this, arguments); }
Point.fill = function () { };
Point.prototype.init = function (x, y) { this.x = x; this.y = y; };
function points(count) { var sum = 0; for (var i = 0; i < count; i++) { var p = new Point(i, 0.5); sum += p.x + p.y; } return sum; }
console.log(points(10));
Point.fill.apply = function (self, args) { args[0] = "changed"; args.length = 1; };
console.log(points(3), show(new Point(1, 2)));
delete Point.fill.apply;
console.log(points(10));
Point.fill = { apply(self, args) { args[1] = { deep: 1 }; delete args[0]; } };
console.log(points(2), show(new Point(1, 2)));
Point.fill = function () { };
Point.prototype.init = function (x) { this.x = x; this.y = -0; };
console.log(points(10), show(new Point("one", 2)));

// A call that may run again, a call behind a test, calls in both arms, a call whose result is taken, and a call in a try block.
function again() { for (var i = 0; i < 3; i++) if (i === 1) twice.apply = function (self, args) { args[0] *= 2; return "own " + args[0]; }; else if (i === 2) delete twice.apply; return twice.apply(this, arguments); }
function twice(a, b) { return a + "," + b; }
function either() { if (arguments.length & 1) return twice.apply(null, arguments); return again.apply(this, arguments); }
function both() { var first = twice.apply(null, arguments); try { return first + "|" + thrower.apply(this, arguments); } catch (error) { return first + "!" + twice.apply(this, arguments); } }
function thrower(a) { if (a > 1) throw a; return a; }
for (var i = 0; i < 4; i++) console.log(again(i, "b"), both(i, -0), either(i, i));
