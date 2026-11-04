exports.secret = function secret() {
  return "secret of inner";
};
exports.readIndex = () => module[0];
