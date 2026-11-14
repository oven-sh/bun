var log = [];
exports.log = log;
exports.comparators = {
  numbers: function (a, b) { return a - b; },
  texts: function (a, b) { return String(a - b); },
  booleans: function (a, b) { return a > b; },
  notANumber: function () { return NaN; },
  nothing: function () {},
  objects: function (a, b) { return { valueOf: function () { log.push("valueOf"); return b - a; } }; },
  big: function (a, b) { return BigInt(a - b); },
  symbols: function () { return Symbol("no number"); },
  throwing: function () { throw new EvalError("no order"); },
  shrinking: function (a, b) { exports.victim.length = 1; return a - b; },
};
exports.mappers = {
  numbers: function (item) { return item * 2; },
  texts: function (item) { return String(item); },
  nothing: function () {},
  lists: function (item) { return [item, [item]]; },
  growing: function (item, index, list) { if (list.length < 6) list.push(item + 10); return item; },
  deleting: function (item, index, list) { delete list[index + 1]; return item; },
  thisValue: function () { return typeof this; },
  operands: function () { return arguments.length; },
};
exports.tests = {
  booleans: function (item) { return item > 1; },
  numbers: function (item) { return item - 1; },
  texts: function (item) { return item > 1 ? "yes" : ""; },
  objects: function () { return new Boolean(false); },
  nothing: function () {},
  notANumber: function () { return NaN; },
  minusZero: function () { return -0; },
  bigZero: function () { return 0n; },
  documentAllLike: function () { return null; },
};
exports.reducers = {
  sum: function (sum, item) { return sum + item; },
  text: function (sum, item) { return sum + String(item); },
  switching: function (sum, item) { return item === 2 ? String(sum) : sum + item; },
  nothing: function () {},
  big: function (sum, item) { return BigInt(sum) + BigInt(item); },
};
