exports.add = function (a, b) { return a + b | 0; };
exports.Point = function Point(x) { this.x = x & 15; };
