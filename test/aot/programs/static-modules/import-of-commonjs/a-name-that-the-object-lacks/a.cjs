console.log("a runs");
exports.a = 1;
setTimeout(() => {
  exports.late = 2;
});
