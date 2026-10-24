var tools = require("./text-tools.cjs");

module.exports = function (rounds) {
  var total = 0;
  for (var i = 0; i < rounds; i++) {
    total += tools.hash("hello") + tools.capitalize("hello").length + tools.count({}, "hello").hello + tools.pad("x", 3).length;
    if (tools.isName("hello")) total++;
  }
  return total;
};
