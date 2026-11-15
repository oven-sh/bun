function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
var state = { n: 3 };
exports.Point = Point; exports.state = state;
exports.run = function (k) { var t = 0; for (var i = 0; i < k; i++) { t += new Point(i, 1).sum(); t += state.n; } return t; };
