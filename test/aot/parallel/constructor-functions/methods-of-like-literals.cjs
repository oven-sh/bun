// STATISTIC: SlotsCarriedAroundLoops >= 2
// Two literals of the same names have functions of their own. A method that stores into this is no constructor: this is the literal.
var out = { sum: 0, lines: 0, write: function (s) { this.check(s); }, writeLine: function (s) { this.lines++; this.check(s + "\n"); },
  check: function (s) { for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); this.sum = ((this.sum << 1) ^ c) | 0; } } };
var err = { sum: 0, lines: 0, write: function (s) { this.check(s); }, writeLine: function (s) { this.lines++; this.check(s + "\n"); },
  check: function (s) { for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); this.sum = ((this.sum << 2) ^ c) | 0; } } };
function Emitter(target) { this.target = target; this.column = 0; }
Emitter.prototype.emit = function (s) { this.target.write(s); this.column += s.length; };
Emitter.prototype.end = function () { this.target.writeLine(""); this.column = 0; };
function run(n) {
  var emitters = [new Emitter(out), new Emitter(err)];
  for (var i = 0; i < n; i++) { emitters[i & 1].emit("text " + i); if (i % 5 === 0) emitters[i % 2].end(); }
  return [out.sum, out.lines, err.sum, err.lines, emitters[0].column].join();
}
console.log(run(40));
// A function of a literal that the file constructs stays a constructor.
var shapes = { x: 1, Point: function (x) { this.x = x; this.y = 2; } };
var points = [];
for (var k = 0; k < 4; k++) points.push(new shapes.Point(k));
console.log(points.map(function (p) { return p.x + p.y; }).join(), points[0] instanceof shapes.Point, shapes.x);
shapes.Point.call(shapes, 9);
console.log(shapes.x, shapes.y);
