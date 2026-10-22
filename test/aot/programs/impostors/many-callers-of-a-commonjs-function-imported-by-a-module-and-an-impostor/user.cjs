var tools = require("./tools.cjs");

exports.honest = function (round) {
  console.log(round, "required:", tools.sum([1, 2, 3]), tools.sum([]), tools.double(2), tools.double(0.5), tools.span({ x: 3, y: 1 }), tools.whoCalls());
};

exports.withValue = function (name, value) {
  return tools[name](value);
};
