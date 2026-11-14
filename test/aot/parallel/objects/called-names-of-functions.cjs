// STATISTIC: FunctionNamesReadFromMirrors >= 4
"use strict";
const Space = {};
(function () {
  function Maths() {}
  function Shape(size) {
    this.size = size;
  }
  Space.Maths = Maths;
  Space.Shape = Shape;
})();
(function () {
  const Maths = Space.Maths, Shape = Space.Shape;
  Maths.clamp = function (value, low, high) {
    return value < low ? low : value > high ? high : value;
  };
  Maths.mix = function (a, b, part) {
    return Maths.clamp(a, 0, 10) * (1 - part) + Maths.clamp(b, 0, 10) * part;
  };
  Shape.scale = function (shape, by) {
    shape.size = Maths.clamp(shape.size * by, 1, 64);
    return shape;
  };
  Space.run = function (count, inner) {
    let sum = 0;
    for (let k = 0; k < count; k++) {
      const shape = new Shape(k + 0.5);
      for (let j = 0; j < inner; j++) sum += Maths.mix(Shape.scale(shape, 1.5).size, j, 0.25);
      sum += Maths.clamp(sum, 0, 1);
    }
    return sum;
  };
})();
console.log(Space.run(6, 3), Space.run(2, 9));
const clamp = Space.Maths.clamp;
Space.Maths.clamp = function (value) {
  return clamp(value, 2, 4);
};
console.log(Space.run(6, 3));
Space.Maths.clamp = undefined;
try {
  console.log(Space.run(6, 3));
} catch (error) {
  console.log(error.constructor.name);
}
Space.Maths.clamp = clamp;
console.log(Space.run(6, 3));
