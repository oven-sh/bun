// An untyped package and a program of it (counted): memoize with resolvers, limits and weak keys; once, curry, compose, partial, after, before, pipeline with placeholders
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var n = 0, f1 = lib.once(function (x) { n += x; return this === undefined || n; }), f2 = lib.after(4, function (x) { return 'after ' + x; }), f3 = lib.before(4, function (x) { return 'before ' + x; }); for (var i = 1; i < 8; i++) say(i, f1(i), n, f2(i), f3(i));
function Point(x, y, z) { this.x = x; this.y = y; this.z = z; this.n = arguments.length; } Point.prototype.sum = function () { return this.x + this.y + (this.z || 0); }; var P = lib.partial(Point, lib._, 5), Q = lib.partial(Point.prototype.sum.call.bind(Point.prototype.sum), lib._); for (var k = 0; k < 6; k++) { var p = new P(k, k % 2 ? 'z' : 1, 9); say(k, p instanceof Point, p.sum(), p.n, JSON.stringify(p), Q(p), lib.partial(Math.max, 3, lib._, k)(k * 2), lib.partial(function () { return [].join.call(arguments, '/'); }, 1, lib._, 3, lib._)(k)); }
