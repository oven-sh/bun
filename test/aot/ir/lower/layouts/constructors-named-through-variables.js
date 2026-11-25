// RUN: link
// CHECK: layout {{*}}kind=Instance name="Point" {{*}}fields=[{key="x" declared={type=anything}}, {key="y" declared={type=anything}}] flags=[IsConstructorFunction]
// CHECK: layout {{*}}kind=Instance name="Shape" {{*}}fields=[{key="center" declared={type=anything}}, {key="radius" declared={type=anything}}] flags=[IsConstructorFunction]

// Constructors that `new` names through variables, calls and IIFEs, and prototype literals that a name holds.
var Point = function Point() {
  this.initialize.apply(this, arguments);
};
Point.prototype.initialize = function (x, y) {
  this.x = x;
  this.y = y;
};

var Circle = (function (methods) {
  function Shape() {
    this.initialize.apply(this, arguments);
  }
  Shape.prototype = methods;
  return Shape;
})({
  initialize: function (center, radius) {
    this.center = center;
    this.radius = radius;
  },
});

var Assigned = (function (methods) {
  function Mixed() {
    this.initialize.apply(this, arguments);
  }
  Object.assign(Mixed.prototype, methods);
  return Mixed;
})({
  initialize: function (first) {
    this.first = first;
  },
});

export const made = [new Circle(new Point(1, 2), 3), new Assigned(4)];
