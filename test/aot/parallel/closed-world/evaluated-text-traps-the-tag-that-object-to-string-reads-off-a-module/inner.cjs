exports.secret = function secret() {
  return "secret of inner";
};
exports.describe = () => Object.prototype.toString.call(module);
