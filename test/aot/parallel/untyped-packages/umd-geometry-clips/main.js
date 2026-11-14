// An untyped package and a program of it (clips): a UMD file of classes written as ES5: hierarchies, getters, polygons and circles
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
for (var i = 1; i < 16; i++) { var a = new lib.Polygon([[0, 0], [4, 0], [4, 4], [0, 4]]), b = a.map(function (p) { return p.add(new lib.Vec(i / 4, i / 8)).rotate(i / 10); }), c = a.clip(b); say(i, c.list.join(' '), c.area().toFixed(5), b.area().toFixed(5)); var v = new lib.Vec(3, 4); v.length = i; say(String(v), v.length.toFixed(6), new lib.Vec().length, Object.keys(v).join(), c.describe().replace(/\d+ /, ' ')); if (i === 8) { lib.Shape.prototype.describe = function () { return 'late ' + this.name + '7 '; }; } if (i === 12) lib.Vec.prototype.toString = function () { return '<' + this.x.toFixed(2) + '>'; }; }
