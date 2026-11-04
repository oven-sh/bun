exports.secret = function secret() {
  return "secret of inner";
};
exports.underKey = key => module[key];
