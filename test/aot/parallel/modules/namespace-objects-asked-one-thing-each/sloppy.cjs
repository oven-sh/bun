exports.store = function (target) {
  target.storedBySloppyCode = 2;
  return target.storedBySloppyCode;
};
exports.remove = function (target) {
  return delete target.deletedBySloppyCode;
};
