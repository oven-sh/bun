exports.sum = function (list) {
  var total = 0;
  for (var i = 0; i < list.length; i++) total += list[i];
  return total;
};

exports.double = function (n) {
  return n * 2;
};

exports.span = function (point) {
  return point.x - point.y;
};

exports.shout = function (text) {
  return text.toUpperCase();
};

exports.low = function (n) {
  return n & 15;
};
