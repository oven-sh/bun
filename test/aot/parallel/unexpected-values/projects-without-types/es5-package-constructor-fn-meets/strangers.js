var shapes = require("shapes");

exports.circle = function () {
  return new shapes.Circle(2);
};
exports.square = function () {
  return new shapes.Square(2);
};
exports.literal = function () {
  return { name: "literal", tags: [], radius: 2, area: function () { return "an area in words"; } };
};
exports.heirOfACircle = function () {
  return Object.create(new shapes.Circle(2), { radius: { get: function () { return "a radius from a getter"; } } });
};
exports.circleWithATextRadius = function () {
  return new shapes.Circle("2");
};
exports.circleWithoutTags = function () {
  var circle = new shapes.Circle(2);
  delete circle.tags;
  return circle;
};
exports.circleWithTextTags = function () {
  var circle = new shapes.Circle(2);
  circle.tags = "tags";
  return circle;
};
exports.circleWithItsOwnArea = function () {
  var circle = new shapes.Circle(2);
  circle.area = function () { return -0; };
  return circle;
};
exports.circleMovedToSquares = function () {
  return Object.setPrototypeOf(new shapes.Circle(2), shapes.Square.prototype);
};
exports.madeWithoutNew = function () {
  return shapes.Shape("made without new");
};
exports.bareObject = function () {
  return Object.create(null);
};
exports.frozenCircle = function () {
  return Object.freeze(new shapes.Circle(2));
};
