exports.describe = function (shape) {
  return shape.describe();
};

exports.perimeter = function (shape) {
  return shape.perimeter(shape.edge);
};

exports.area = function (shape) {
  return shape.area();
};

exports.sides = function (shape) {
  return shape.sides;
};
