"use strict";
var modules = {
  1: (module, exports, require_) => { exports.a = require_(2).b + 1; },
  2: (module, exports) => { exports.b = require("./leaf.cjs").leaf; },
};
var cache = {};
function require_(id) {
  var cached = cache[id];
  if (cached !== undefined) return cached.exports;
  var module = (cache[id] = { exports: {} });
  modules[id](module, module.exports, require_);
  return module.exports;
}
module.exports = { value: require_(1).a, count: () => module.children.length, parent: module.parent, own: module };
