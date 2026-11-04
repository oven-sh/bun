"use strict";
const helpers = require("./helpers.js");
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(helpers.square(this.x) + helpers.square(this.y));
  }
  scaled(by: number): Point {
    return new Point(this.x * by, this.y * by);
  }
}
function measure(x: number, y: number): number {
  const point = new Point(x, y);
  return point.scaled(2).norm() + point.x;
}
function describe(point: Point): string {
  return point.x + "," + point.y + ":" + point.norm();
}
exports.Point = Point;
exports.measure = measure;
exports.describe = describe;
