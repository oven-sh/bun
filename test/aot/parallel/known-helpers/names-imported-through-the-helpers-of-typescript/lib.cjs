"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Point = exports.seven = exports.count = void 0;
exports.inc = inc;
exports.default = named;
exports.count = 0;
function inc() { exports.count++; return exports.count; }
exports.seven = 7;
class Point {
    x;
    constructor(x) {
        this.x = x;
    }
}
exports.Point = Point;
function named() { return "default"; }
