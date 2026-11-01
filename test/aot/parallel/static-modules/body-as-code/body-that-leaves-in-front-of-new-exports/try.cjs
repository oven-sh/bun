try {
  if (globalThis.skip) return;
} finally {
  globalThis.left = true;
}
module.exports = function () {};
