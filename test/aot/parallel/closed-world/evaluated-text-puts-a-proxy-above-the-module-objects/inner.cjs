exports.secret = function secret() {
  return "secret of inner";
};
exports.isHot = () => String(module.hot);
