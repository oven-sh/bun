// A helper that a namespace holds links classes that the namespace holds; a parameter of a function that is called where it is written stands for the namespace.
var Box = {};
(function (F) { function K() { } F.inherit = function (y, w) { K.prototype = w.prototype; y.prototype = new K; y.prototype.constructor = y; }; })(Box);
Box.A = {};
(function () {
  function S() { S.Shape.apply(this, arguments); this.constructor === S && this.Shape.apply(this, arguments); }
  function C() { C.Circle.apply(this, arguments); this.constructor === C && this.Circle.apply(this, arguments); }
  function D() { D.Disk.apply(this, arguments); this.constructor === D && this.Disk.apply(this, arguments); }
  Box.A.Shape = S; Box.A.Circle = C; Box.A.Disk = D;
})();
(function () {
  var S = Box.A.Shape, C = Box.A.Circle, D = Box.A.Disk;
  S.Shape = function () { this.c = 1; };
  S.prototype.Shape = function () { this.type = 1; this.radius = 0.5; };
  S.prototype.area = function () { return this.radius * this.c; };
  Box.inherit(C, Box.A.Shape); C.prototype.__super = Box.A.Shape.prototype;
  C.Circle = function () { Box.A.Shape.Shape.apply(this, arguments); this.p = 2; };
  C.prototype.Circle = function (r) { this.__super.Shape.call(this); this.radius = r; };
  C.prototype.grow = function () { this.radius += 0.25; return this.p; };
  Box.inherit(D, Box.A.Circle); D.prototype.__super = Box.A.Circle.prototype;
  D.Disk = function () { Box.A.Circle.Circle.apply(this, arguments); this.q = "q"; };
  D.prototype.Disk = function (r) { this.radius = r * 2; };
  D.prototype.grow = function () { this.radius -= 0.5; return this.q; };
})();
var all = []; for (var i = 0; i < 30; i++) all.push(new Box.A[["Shape", "Circle", "Disk"][i % 3]](i));
function sum(n) { var t = 0, s = ""; for (var i = 0; i < n; i++) { var o = all[i % 30]; if (o.grow) s = (s + o.grow()).slice(-20); t += o.area(); } return t + s; }
var one = new Box.A.Circle(1), two = new Box.A.Disk(3); function loop(o, n) { var t = 0; for (var i = 0; i < n; i++) { o.grow(); t += o.area(); } return t; }
console.log(sum(30), sum(400), loop(one, 300), loop(two, 300), one instanceof Box.A.Shape, two instanceof Box.A.Circle, all[0] instanceof Box.A.Circle);
console.log(Object.keys(one).join(), Object.keys(two).join(), Object.keys(all[0]).join(), Object.keys(Box.A.Disk.prototype).join());
Box.A.Circle.prototype.area = function () { return "a"; }; console.log(sum(6), one.area());
Object.setPrototypeOf(Box.A.Disk.prototype, { area: function () { return 7; } }); console.log(two.area(), two instanceof Box.A.Circle);
var old = Box.inherit; Box.inherit = function (y, w) { y.prototype = { constructor: y, kind: w.name }; };
function E() { this.e = 1; } Box.A.E = E; Box.inherit(E, Box.A.Shape); console.log(new Box.A.E().kind, typeof new Box.A.E().area, old !== Box.inherit);
