// A sloppy package: `this` of its functions may be the global object as far as their text says.
function Point(x, y) { this.x = x; this.y = y; this.init(); }
Point.prototype.init = function () { var self = this; self.sum = self.x + self.y; return this; };
Point.prototype.total = function () { return this.sum; };
function Counter() { if (!(this instanceof Counter)) return new Counter(); this.n = 0; }
Counter.prototype.add = function (p) { this.n += p.total(); return this; };
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.lib = factory(); })(typeof self !== "undefined" ? self : this, function () { return { Point: Point, Counter: Counter }; });
