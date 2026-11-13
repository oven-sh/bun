const limit = 5, name = "a";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};
var lib_exports = {};
__export(lib_exports, { limit: () => limit, name: () => name });
export const sum = values => values.length + { ...lib_exports }.limit + lib_exports.limit;
export function text() {
  let said = Object.keys(lib_exports).join();
  try {
    lib_exports.limit = 7;
  } catch (error) {
    said += error.constructor.name;
  }
  return said + lib_exports.limit + lib_exports?.name;
}
