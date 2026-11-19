exports.sorted = function (list, compare) {
  return list.sort(compare);
};
exports.mapped = function (list, map) {
  return list.map(map);
};
exports.flat = function (list, map) {
  return list.flatMap(map);
};
exports.kept = function (list, test) {
  return list.filter(test);
};
exports.found = function (list, test) {
  return [list.find(test), list.findIndex(test), list.some(test), list.every(test)];
};
exports.reduced = function (list, reduce) {
  return list.reduce(reduce, 0) + 1;
};
exports.reducedWithoutAStart = function (list, reduce) {
  return list.reduce(reduce);
};
exports.replaced = function (list, map) {
  return "1-2-3".replace(/\d/g, function (digit) { return map(Number(digit), 0, list); });
};
exports.made = function (list, map) {
  return Array.from(list, map);
};
