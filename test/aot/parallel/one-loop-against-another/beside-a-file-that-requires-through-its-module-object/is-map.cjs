const load = module.require;
const { types } = load.call(module, "node:util");
module.exports = function isMap(value) {
  return types.isMap(value);
};
