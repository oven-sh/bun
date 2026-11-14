(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.geometry = {}));
})(this, (function (exports) { 'use strict';
  var EPS = 1e-9;
  function __extends(d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __()); }
  var Vec = /** @class */ (function () {
    function Vec(x, y) { if (x === void 0) { x = 0; } if (y === void 0) { y = 0; } this.x = x; this.y = y; }
    Vec.prototype.add = function (o) { return new Vec(this.x + o.x, this.y + o.y); };
    Vec.prototype.sub = function (o) { return new Vec(this.x - o.x, this.y - o.y); };
    Vec.prototype.mul = function (k) { return new Vec(this.x * k, this.y * k); };
    Vec.prototype.dot = function (o) { return this.x * o.x + this.y * o.y; };
    Vec.prototype.cross = function (o) { return this.x * o.y - this.y * o.x; };
    Vec.prototype.rotate = function (a) { var c = Math.cos(a), s = Math.sin(a); return new Vec(this.x * c - this.y * s, this.x * s + this.y * c); };
    Object.defineProperty(Vec.prototype, "length", { get: function () { return Math.hypot(this.x, this.y); }, set: function (n) { var k = n / (this.length || 1); this.x *= k; this.y *= k; }, enumerable: false, configurable: true });
    Vec.prototype.toString = function () { return '(' + +this.x.toFixed(4) + ',' + +this.y.toFixed(4) + ')'; };
    Vec.of = function (a) { return a instanceof Vec ? a : new Vec(a[0], a[1]); };
    return Vec;
  }());
  var Shape = /** @class */ (function () {
    function Shape(name) { this.name = name; this.id = ++Shape.made; }
    Shape.prototype.area = function () { return 0; };
    Shape.prototype.box = function () { var ps = this.points(), b = [Infinity, Infinity, -Infinity, -Infinity]; for (var _i = 0, ps_1 = ps; _i < ps_1.length; _i++) { var p = ps_1[_i]; if (p.x < b[0]) b[0] = p.x; if (p.y < b[1]) b[1] = p.y; if (p.x > b[2]) b[2] = p.x; if (p.y > b[3]) b[3] = p.y; } return b; };
    Shape.prototype.describe = function () { return this.name + this.id + ' ' + this.area().toFixed(3); };
    Shape.made = 0;
    return Shape;
  }());
  var Polygon = /** @class */ (function (_super) {
    __extends(Polygon, _super);
    function Polygon(points, name) { var _this = _super.call(this, name || 'polygon') || this; _this.list = points.map(Vec.of); return _this; }
    Polygon.prototype.points = function () { return this.list; };
    Polygon.prototype.area = function () { var s = 0, l = this.list; for (var i = 0, j = l.length - 1; i < l.length; j = i++) s += l[j].cross(l[i]); return s / 2; };
    Polygon.prototype.contains = function (p) { p = Vec.of(p); var inside = false, l = this.list; for (var i = 0, j = l.length - 1; i < l.length; j = i++) { var a = l[i], b = l[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside; } return inside; };
    Polygon.prototype.map = function (f) { return new this.constructor(this.list.map(f), this.name); };
    Polygon.prototype.clip = function (o) { var out = this.list, cl = o.list; var _loop = function (i) { var a = cl[i], b = cl[(i + 1) % cl.length], input = out; out = []; input.forEach(function (p, k) { var q = input[(k + input.length - 1) % input.length], ip = b.sub(a).cross(p.sub(a)) >= -EPS, iq = b.sub(a).cross(q.sub(a)) >= -EPS; if (ip !== iq) { var d = p.sub(q), n = b.sub(a), t = n.cross(a.sub(q)) / n.cross(d); out.push(q.add(d.mul(t))); } if (ip) out.push(p); }); }; for (var i = 0; i < cl.length; i++) { _loop(i); } return new Polygon(out); };
    return Polygon;
  }(Shape));
  var Circle = /** @class */ (function (_super) {
    __extends(Circle, _super);
    function Circle(c, r) { var _this = _super.call(this, 'circle') || this; _this.c = Vec.of(c); _this.r = r; return _this; }
    Circle.prototype.area = function () { return Math.PI * Math.pow(this.r, 2); };
    Circle.prototype.points = function () { var out = []; for (var i = 0; i < 8; i++) out.push(this.c.add(new Vec(this.r).rotate(i * Math.PI / 4))); return out; };
    Circle.prototype.describe = function () { return _super.prototype.describe.call(this) + ' r' + this.r; };
    return Circle;
  }(Shape));
  function hull(points) { var ps = points.map(Vec.of).sort(function (a, b) { return a.x - b.x || a.y - b.y; }); function half(l) { var h = []; for (var _i = 0, l_1 = l; _i < l_1.length; _i++) { var p = l_1[_i]; while (h.length >= 2 && h[h.length - 1].sub(h[h.length - 2]).cross(p.sub(h[h.length - 1])) <= 0) h.pop(); h.push(p); } h.pop(); return h; } return new Polygon(half(ps).concat(half(ps.slice().reverse())), 'hull'); }
  exports.Circle = Circle; exports.Polygon = Polygon; exports.Shape = Shape; exports.Vec = Vec; exports.hull = hull;
  Object.defineProperty(exports, '__esModule', { value: true });
}));
