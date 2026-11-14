// An untyped package and a program of it (shapes): a UMD file of classes written as ES5: hierarchies, getters, polygons and circles
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var seed = 3; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
for (var i = 0; i < 20; i++) { var s = i % 3 === 0 ? new lib.Circle([i, -i], 1 + rnd() * 4) : i % 3 === 1 ? new lib.Polygon([[0, 0], [i, 0], [i, 2], [0, 2]]) : lib.hull(Array.from({ length: 5 + i }, function () { return [rnd() * 10, rnd() * 10]; })); say(i, s.describe(), s.box().map(function (v) { return v.toFixed(3); }).join(), s instanceof lib.Shape, s.points().length, s.contains ? [s.contains([1, 1]), s.contains([5, 5]), s.contains([-1, 0])].join() : '-', s.constructor.name, lib.Polygon.made === lib.Shape.made, lib.Shape.made); }
