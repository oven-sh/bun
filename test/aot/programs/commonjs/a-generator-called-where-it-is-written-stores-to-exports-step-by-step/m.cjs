exports.it = (function* () {
  exports.a = 1;
  yield (exports.b = 2);
  exports.c = 3;
})();
exports.it.next();
