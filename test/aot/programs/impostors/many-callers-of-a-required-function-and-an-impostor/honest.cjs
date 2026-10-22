var tools = require("./tools.cjs");
var Counter = require("./counter.cjs");
var sum = tools.sum;
var { double, span } = require("./tools.cjs");

module.exports = function honest(round) {
  console.log(round, "sum", sum([1, 2, 3]), sum([]), sum(new Array(4, 5)), tools.sum([0.5, 0.25]), tools.sum(Array.of(6)));
  console.log(round, "double", double(1), double(2.5), double(-3), tools.double(0), tools.double(1e10));
  console.log(round, "span", span({ x: 3, y: 1 }), span({ x: 0.5, y: 0.25 }), tools.span({ x: -1, y: -1 }), tools.span({ x: 9, y: 4 }));
  console.log(round, "shout", tools.shout("abc"), tools.shout(""), tools.shout("x" + round), tools.shout(round + "!"));
  console.log(round, "low", tools.low(1), tools.low(17), tools.low(-1), tools.low(255), tools.low(16));
  console.log(round, "counter", new Counter(1).add(2), new Counter(0).add(0.5), new Counter(-1).add(1));
};
