const c = require("./c.cjs");
const d = require("./d.cjs");
var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
var freeModule = freeExports && typeof module == "object" && module && !module.nodeType && module;
var moduleExports = freeModule && freeModule.exports === freeExports;
var types = (function () {
  try {
    return freeModule && freeModule.require && freeModule.require("node:util").types;
  } catch (e) {}
})();
const kept = typeof module == "object" && module;
let late = true && module;
exports.report = () => [moduleExports, typeof types.isDate, kept === module, kept.exports === exports, late === freeModule, typeof kept.filename, kept.loaded, c.name + d.name];
