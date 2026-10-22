exports.lost = 1;
module.exports = function f() {
  return [exports.lost, exports.alsoLost, module.exports.kept].join();
};
module.exports.kept = 2;
exports.alsoLost = 3;
this.lostToo = 4;
