const limit = 5;
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};
var lib_exports = {};
__export(lib_exports, { limit: () => limit });
class Table {
  static size = lib_exports.limit;
  rows = lib_exports.limit;
  read() {
    return () => lib_exports.limit + this.rows;
  }
}
function* numbers() {
  for (let i = 0; i < lib_exports.limit; i++) yield i;
}
export const sum = values => new Table().read()() + [...numbers()].length + values.length + Table.size;
export function text() {
  try {
    if (lib_exports.limit > 4) throw new Error("over " + lib_exports.limit);
  } catch (error) {
    return error.message;
  }
  return lib_exports["limit"];
}
