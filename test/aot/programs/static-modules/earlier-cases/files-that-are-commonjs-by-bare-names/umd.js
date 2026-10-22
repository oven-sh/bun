;(function () {
  var root = typeof globalThis == 'object' && globalThis;
  var freeExports = typeof exports == 'object' && exports && !exports.nodeType && exports;
  var freeModule = freeExports && typeof module == 'object' && module && !module.nodeType && module;
  var moduleExports = freeModule && freeModule.exports === freeExports;
  function lib() { return "lib called"; }
  lib.moduleExports = moduleExports;
  if (freeModule) { (freeModule.exports = lib)._ = lib; freeExports._ = lib; } else { root._ = lib; }
}.call(this));
