exports.secret = function secret() {
  return "secret of inner";
};
// What a bundler writes to ask for hot reloading.
exports.isHot = () => (module.hot ? "hot" : "cold");
