// STATISTIC: InstanceOfConstructorsTested >= 4
"use strict";
var Shapes = {};
(function () {
  function Shape(size) {
    this.size = size;
  }
  function Circle(size) {
    this.radius = size;
  }
  function Other() {}
  Shapes.Shape = Shape;
  Shapes.Circle = Circle;
  Shapes.Other = Other;
})();
var tests = [];
(function () {
  tests.push(function (value) {
    return value instanceof Shape ? value.size : value instanceof Circle ? -value.radius : 0;
  });
  tests.push(function (values) {
    var sum = 0;
    for (var k = 0; k < values.length; k++) {
      var shape = values[k] instanceof Shape ? values[k] : null;
      if (shape) sum += shape.size;
      else if (values[k] instanceof Other) sum += 100;
    }
    return sum;
  });
  try {
    console.log(tests[0]({}));
  } catch (error) {
    console.log(error.constructor.name, error.message);
  }
  var Shape = Shapes.Shape, Circle = Shapes.Circle, Other = Shapes.Other;
})();
var made = [new Shapes.Shape(2), new Shapes.Circle(3), new Shapes.Other(), new Shapes.Shape(0.5), Object.create(Shapes.Shape.prototype)];
console.log(made.map(tests[0]).join(), [1, null, undefined, "s", {}].map(tests[0]).join());
var total = 0;
for (var turn = 0; turn < 300; turn++) total += tests[1](made.slice(0, 4)) + tests[0](made[turn % 4]);
console.log(total);
Object.setPrototypeOf(made[1], Shapes.Shape.prototype);
console.log(made.map(tests[0]).join());
Shapes.Circle.prototype = {};
console.log(made.map(tests[0]).join(), tests[0](new Shapes.Circle(7)));
