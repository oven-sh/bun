const ownExports = typeof exports === "object" && exports !== null && exports;
const ownModule =
  ownExports && typeof module === "object" && module !== null && module.exports === ownExports && module;
let types;
try {
  types = ownModule && ownModule.require && ownModule.require("node:util").types;
} catch {}
module.exports = function isMap(value) {
  return types ? types.isMap(value) : value instanceof Map;
};
