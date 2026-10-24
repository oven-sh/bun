exports.b = 1;
exports.a = 2;
setTimeout(() => {
  exports.late = 3;
});
