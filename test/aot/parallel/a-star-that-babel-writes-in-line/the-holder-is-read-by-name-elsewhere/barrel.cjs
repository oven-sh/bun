"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var _leaf = require("./leaf.cjs");
Object.keys(_leaf).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _leaf[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _leaf[key];
    }
  });
});
exports.sum = (0, _leaf.add)(20, _leaf.two);
