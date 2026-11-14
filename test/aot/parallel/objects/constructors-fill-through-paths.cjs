// Classes of a namespace whose fields are stored by functions that the constructor applies to its object, as a compiler to JavaScript writes them.
var Lib = {};
Lib.math = {}; Lib.shapes = {};
(function () {
  function K() { }
  Lib.inherit = function (below, above) { K.prototype = above.prototype; below.prototype = new K; below.prototype.constructor = below; };
  function V() { V.Vec.apply(this, arguments); this.constructor === V && this.Vec.apply(this, arguments); }
  function S() { S.Shape.apply(this, arguments); this.constructor === S && this.Shape.apply(this, arguments); }
  function C() { C.Circle.apply(this, arguments); this.constructor === C && this.Circle.apply(this, arguments); }
  Lib.math.Vec = V; Lib.shapes.Shape = S; Lib.shapes.Circle = C;
})();
(function () {
  var V = Lib.math.Vec;
  V.Vec = function () { };
  V.prototype.Vec = function (x, y) { if (x === undefined) x = 0; if (y === undefined) y = 0; this.x = x; this.y = y; };
  V.prototype.add = function (o) { this.x += o.x; this.y += o.y; return this; };
})();
(function () {
  var V = Lib.math.Vec, S = Lib.shapes.Shape, C = Lib.shapes.Circle;
  S.Shape = function () { this.center = new V(1, 2); };
  S.prototype.Shape = function () { this.type = "shape"; this.radius = 0.5; };
  Lib.inherit(C, Lib.shapes.Shape);
  C.prototype.__super = Lib.shapes.Shape.prototype;
  C.Circle = function () { Lib.shapes.Shape.Shape.apply(this, arguments); this.local = new V; };
  C.prototype.Circle = function (r) { this.__super.Shape.call(this); this.type = "circle"; this.radius = r; };
  C.prototype.area = function () { return this.radius * this.radius + this.center.x + this.local.y; };
})();
var all = []; for (var i = 0; i < 40; i++) all.push(i % 3 ? new Lib.shapes.Circle(i) : new Lib.shapes.Shape());
function sum(n) { var s = 0; for (var i = 0; i < n; i++) { var o = all[i % 40]; o.center.add(o.local || o.center); s = s + o.radius + o.center.x; if (o.area) s += o.area(); } return s; }
console.log(sum(40), sum(400), all.slice(0, 4).map(function (o) { return Object.keys(o).join() + ":" + o.type + ":" + (o instanceof Lib.shapes.Shape) + (o instanceof Lib.shapes.Circle); }).join(" "));
var v = new Lib.math.Vec(3); v.z = 4; delete v.y; console.log(JSON.stringify(v), "y" in v, Object.keys(new Lib.math.Vec(1, 2)).join());
Lib.math.Vec.prototype.Vec = function () { this.late = 1; }; console.log(JSON.stringify(new Lib.math.Vec(5, 6)));
Lib.shapes.Shape.Shape = function () { this.other = 7; }; console.log(JSON.stringify(new Lib.shapes.Circle(2)), JSON.stringify(new Lib.shapes.Shape()));
var called = {}; Lib.math.Vec.call(called, 1, 2); console.log(JSON.stringify(called)); try { Lib.math.Vec(1); } catch (e) { console.log(e.constructor.name); }
all[1].radius = "r"; all[2].center = null; try { console.log(sum(3)); } catch (e) { console.log(e.constructor.name); }
