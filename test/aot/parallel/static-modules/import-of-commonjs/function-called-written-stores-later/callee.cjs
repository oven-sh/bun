let count = 0;
(function () {
  exports.m = ++count;
  globalThis.callee = arguments.callee;
})();
