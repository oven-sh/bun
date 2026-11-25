const limit = 5, unit = "day";
let step = 2;
var last = -1;
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};
var lib_exports = {};
__export(lib_exports, { limit: () => limit, unit: () => unit, step: () => step, last: () => last, add: () => add });
function add(a, b) {
  return a + b;
}
export const sum = values => values.reduce((total, value) => lib_exports.add(total, value) * lib_exports.step, lib_exports.limit);
export function text() {
  return [lib_exports.unit, lib_exports.last, () => lib_exports.limit].map(it => (typeof it === "function" ? it() : it)).join();
}
