var lib = require("./lib");
var size = lib.size;
var version = lib.version;

exports.throughTheObject = function (list) {
  return lib.size(list) + 1;
};
exports.throughTheCopy = function (list) {
  return size(list) + 1;
};
exports.nextVersion = function () {
  return lib.version + 1;
};
exports.nextCopiedVersion = function () {
  return version + 1;
};
exports.joined = function () {
  return lib.names.join("+");
};
exports.count = function () {
  return lib.names.length;
};
exports.extra = function () {
  return lib.extra();
};
exports.gone = function () {
  return ["gone" in lib, lib.gone, Object.keys(lib).join()];
};
