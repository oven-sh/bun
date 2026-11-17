// A helper links classes that namespaces hold. Some are not there yet when it is called.
var Early = {}, Never = {}, Null = {}, Childless = {};
var log = [];

function Between() {}
Early.inherit = function (child, parent) {
  Between.prototype = parent.prototype;
  child.prototype = new Between();
  child.prototype.constructor = child;
};
Never.inherit = function (child, parent) {
  child.__proto__ = parent;
};
Null.inherit = function (child, parent) {
  child.__proto__ = parent;
};
Childless.inherit = function (child, parent) {
  child.super_ = parent;
  Object.setPrototypeOf(child.prototype, parent.prototype);
};

function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.name;
  }
}

Early.shapes = {};
(function () {
  function Shape() {
    this.radius = 1;
  }
  function Circle() {
    this.radius = 2;
    this.step = 0.25;
  }
  Shape.prototype.area = function () {
    return this.radius * 3;
  };
  Early.shapes.Circle = Circle;
  log.push(attempt(() => Early.inherit(Early.shapes.Circle, Early.shapes.Shape)), attempt(() => new Circle().area()));
  Early.shapes.Shape = Shape;
  log.push(attempt(() => Early.inherit(Early.shapes.Circle, Early.shapes.Shape)), attempt(() => new Circle().area()));
  Circle.prototype.grow = function () {
    this.radius += this.step;
    return this;
  };
  var circle = new Early.shapes.Circle();
  var sum = 0;
  for (var i = 0; i < 20; i++) sum += circle.grow().area();
  log.push(sum, circle instanceof Shape, Object.getPrototypeOf(Circle.prototype) === Shape.prototype);
})();

Never.shapes = {};
(function () {
  function Shape() {}
  function Circle() {
    this.radius = 2;
  }
  Shape.make = () => "made";
  Never.shapes.Circle = Circle;
  if (process.argv.length > 50) Never.shapes.Shape = Shape;
  log.push(attempt(() => Never.inherit(Never.shapes.Circle, Never.shapes.Shape)), attempt(() => Circle.make()));
  log.push(attempt(() => typeof Circle.call), attempt(() => Object.getPrototypeOf(Circle) === Function.prototype));
})();

Null.shapes = {};
(function () {
  function Shape() {}
  function Circle() {
    this.radius = 2;
  }
  Shape.make = () => "made";
  Null.shapes.Circle = Circle;
  Null.shapes.Shape = null;
  log.push(attempt(() => Null.inherit(Null.shapes.Circle, Null.shapes.Shape)), attempt(() => Circle.make()));
  log.push(attempt(() => typeof Circle.call), attempt(() => Object.getPrototypeOf(Circle)));
  Null.shapes.Shape = Shape;
  log.push(attempt(() => Object.setPrototypeOf(Circle, Function.prototype) === Circle));
  log.push(attempt(() => Null.inherit(Null.shapes.Circle, Null.shapes.Shape)), attempt(() => Circle.make()));
})();

Childless.shapes = {};
(function () {
  function Shape() {}
  function Circle() {
    this.radius = 2;
  }
  Shape.prototype.name = "shape";
  Childless.shapes.Shape = Shape;
  log.push(attempt(() => Childless.inherit(Childless.shapes.Circle, Childless.shapes.Shape)), Circle.super_ === undefined);
  Childless.shapes.Circle = Circle;
  log.push(attempt(() => Childless.inherit(Childless.shapes.Circle)), "super_" in Circle, Circle.super_ === undefined);
  log.push(attempt(() => Childless.inherit(Childless.shapes.Circle, Childless.shapes.Shape)), Circle.super_ === Shape);
  var names = "";
  for (var i = 0; i < 8; i++) names += new Childless.shapes.Circle().name;
  log.push(names);
})();

console.log(log.join("\n"));
