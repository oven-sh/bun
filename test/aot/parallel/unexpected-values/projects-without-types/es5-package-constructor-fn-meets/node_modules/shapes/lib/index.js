exports.Shape = require("./shape");
exports.Circle = require("./circle");
exports.Square = require("./square");
exports.totalArea = function (shapes) {
  var total = 0;
  for (var i = 0; i < shapes.length; i++) total += shapes[i].area();
  return total;
};
exports.radiusOf = function (circle) {
  return circle.radius;
};
