exports.pushed = function (list) {
  return list.push("d");
};
exports.popped = function (list) {
  return list.pop();
};
exports.mapped = function (list) {
  return list.map(function (item) { return item + item; });
};
exports.found = function (list) {
  return list.indexOf("b");
};
exports.size = function (list) {
  return list.length;
};
exports.third = function (list) {
  return list[2];
};
exports.storedPastTheEnd = function (list) {
  list[5] = "f";
  return list.length;
};
exports.cut = function (list) {
  list.length = 1;
  return [list[0], list[1], 1 in list];
};
exports.walked = function (list) {
  var seen = [];
  for (var item of list) seen.push(item);
  return seen;
};
exports.glued = function (list) {
  return [].concat(list).length;
};
exports.isList = function (list) {
  return Array.isArray(list);
};
exports.written = function (list) {
  return JSON.stringify(list);
};
exports.sliced = function (list) {
  var part = list.slice(1);
  return [part.constructor.name, Array.isArray(part), part.length];
};
