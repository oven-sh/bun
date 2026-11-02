let count = 0;
(function again() {
  exports.n = ++count;
  globalThis.named = again;
})();
