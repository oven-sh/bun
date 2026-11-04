exports.secret = function secret() {
  return "secret of inner";
};
exports.markHot = () => {
  module.hot = true;
  return Object.hasOwn(module, "hot") ? "stored on the module object" : "taken by a setter";
};
