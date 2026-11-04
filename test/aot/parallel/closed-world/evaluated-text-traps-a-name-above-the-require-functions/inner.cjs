exports.secret = function secret() {
  return "secret of inner";
};
// A bundler-style check on the program's own require function.
exports.hasContext = () => (require.context ? "webpack" : "plain");
