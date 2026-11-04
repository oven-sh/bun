exports.secret = function secret() {
  return "secret of inner";
};
exports.isHot = () => module[Symbol.for("hot")];
