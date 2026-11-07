exports.storeSloppily = function (object, value) {
  object.x = value;
  return object.x;
};
exports.addSloppily = function (object, value) {
  object.added = value;
  return object.added;
};
exports.deleteSloppily = function (object) {
  return delete object.x;
};
exports.putSloppily = function (object, name, value) {
  object[name] = value;
  return object[name];
};
