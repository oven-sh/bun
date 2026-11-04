exports.secret = function secret() {
  return "secret of inner";
};
exports.throughReflect = () => Reflect.get(module, "hot");
