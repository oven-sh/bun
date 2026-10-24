exports.total = function (list) {
  var sum = 0;
  for (var i = 0; i < list.length; i++) sum += list[i];
  return sum;
};

exports.add = function (list) {
  list[list.length] = 9;
  return list.length;
};

exports.walk = function (list) {
  var seen = [];
  list.forEach(function (value, index) {
    seen.push(index, value);
  });
  return seen;
};
