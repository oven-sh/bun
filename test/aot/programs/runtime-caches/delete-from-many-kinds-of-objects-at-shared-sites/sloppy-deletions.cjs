exports.isSloppy = (function () {
  return this === undefined ? "strict" : "sloppy";
})();
exports.deleteByKeySloppy = function (table, key) {
  try {
    return String(delete table[key]);
  } catch (error) {
    return error.constructor.name;
  }
};
exports.deleteASloppy = function (table) {
  try {
    return String(delete table.a);
  } catch (error) {
    return error.constructor.name;
  }
};
