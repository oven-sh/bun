(() => {
  exports.a = 1;
  if (Date.now() > 0) return;
  exports.b = 2;
})();
exports.c = 3;
