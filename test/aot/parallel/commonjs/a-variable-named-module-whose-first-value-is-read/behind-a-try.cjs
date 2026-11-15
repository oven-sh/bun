try {
  null.x;
  var module = 1;
} catch (error) {
  exports.kind = typeof module;
}
