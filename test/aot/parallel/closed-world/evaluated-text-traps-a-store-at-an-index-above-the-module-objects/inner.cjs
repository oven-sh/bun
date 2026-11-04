exports.secret = function secret() {
  return "secret of inner";
};
exports.storeIndex = () => {
  module[0] = true;
  return Object.hasOwn(module, 0) ? "stored on the module object" : "taken by a setter";
};
