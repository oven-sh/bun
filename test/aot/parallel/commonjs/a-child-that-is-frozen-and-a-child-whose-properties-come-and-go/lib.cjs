exports.a = "real";
exports.read = () => module.exports?.a;
exports.set = value => {
  module.exports = value;
};
