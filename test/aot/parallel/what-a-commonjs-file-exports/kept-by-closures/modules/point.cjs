"use strict";
class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } static get origin() { return new Point(0, 0); } }
module.exports = Point;
