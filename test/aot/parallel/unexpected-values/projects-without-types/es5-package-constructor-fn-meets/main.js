var shapes = require("shapes");
var attempt = require("./show").attempt;
var strangers = require("./strangers");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var uses = {
  area: function (shape) { return shape.area(); },
  borrowedArea: function (shape) { return shapes.Circle.prototype.area.call(shape); },
  describe: function (shape) { return shape.describe(); },
  borrowedDescribe: function (shape) { return shapes.Shape.prototype.describe.call(shape); },
  tag: function (shape) { return shape.tag("t"); },
  borrowedTag: function (shape) { return shapes.Shape.prototype.tag.call(shape, "t"); },
  grow: function (shape) { return shape.grow(1).radius; },
  borrowedGrow: function (shape) { return shapes.Circle.prototype.grow.call(shape, 1).radius; },
  radiusOf: shapes.radiusOf,
  totalArea: function (shape) { return shapes.totalArea([new shapes.Circle(1), shape]); },
  isShape: shapes.Shape.isShape,
  isCircle: function (shape) { return shape instanceof shapes.Circle; },
  maker: function (shape) { return shape.constructor === shapes.Circle; },
  keys: function (shape) { var keys = []; for (var key in shape) keys.push(key); return keys.join(); },
};

var sum = 0;
for (var i = 0; i < 2000; i++) {
  var circle = new shapes.Circle(i % 5);
  sum += uses.area(circle) + uses.borrowedArea(circle) + uses.describe(circle).length + uses.tag(circle) + uses.grow(circle) + uses.radiusOf(circle) + uses.totalArea(circle);
}
console.log("sum", sum);

Object.keys(strangers).forEach(function (stranger) {
  Object.keys(uses).forEach(function (use) {
    attempt(use + "(" + stranger + ")", function () {
      return uses[use](strangers[stranger]());
    });
  });
});
attempt("squares share the tags of their prototype", function () {
  delete new shapes.Square(1).tags;
  var one = new shapes.Square(1);
  delete one.tags;
  one.tag("shared");
  return shapes.Square.prototype.tags;
});
shapes.Circle.prototype.area = function () {
  return "replaced";
};
attempt("after the method was replaced", function () {
  return [uses.area(new shapes.Circle(2)), uses.describe(new shapes.Circle(2)), uses.totalArea(new shapes.Circle(2))];
});
