// Constructors that a path names, whose prototype is a literal with the method that fills their objects.
if (typeof Shapes === "undefined") var Shapes = {};
if (typeof Shapes.Flat === "undefined") Shapes.Flat = {};
Shapes.Flat.Point = function () { this.initialize.apply(this, arguments); };
Shapes.Flat.Point.prototype = {
  x: 0,
  initialize: function (x, y) { this.x = x ? x : 0; this.y = y; },
  sum: function () { return this.x + this.y; },
};
Shapes.Segment = function (from, to) { this.start(from, to); };
Shapes.Segment.prototype = {
  start(from, to) { this.from = from; this.to = to; this.rest(); },
  rest: function () { this.length = this.to.sum() - this.from.sum(); },
  go: function () { return this.length + this.from.x; },
};
function turns(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += new Shapes.Segment(new Shapes.Flat.Point(i, 1), new Shapes.Flat.Point(2, -i)).go();
  return sum;
}
const show = object => Object.keys(object).map(key => key + "=" + (typeof object[key] === "object" ? "{" + show(object[key]) + "}" : object[key])).join();
console.log(turns(40), show(new Shapes.Flat.Point(1)), show(new Shapes.Segment(new Shapes.Flat.Point(1, 2), new Shapes.Flat.Point(3, 4))));
Shapes.Segment.prototype.rest = function () { this.length = "long"; this.more = 1; };
console.log(turns(3), show(new Shapes.Segment(new Shapes.Flat.Point(1, 2), new Shapes.Flat.Point(3, 4))));
Shapes.Flat.Point.prototype = { initialize: function (x) { this.only = x; }, sum: function () { return this.only; } };
console.log(turns(3), show(new Shapes.Flat.Point(5, 6)));
Shapes.Segment = function () { this.other = arguments.length; this.go = () => this.other; };
console.log(turns(3), show(new Shapes.Segment(1, 2)));
delete Shapes.Flat.Point.prototype.initialize;
try { turns(1); } catch (error) { console.log(error instanceof TypeError); }
