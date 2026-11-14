"use strict";
Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  own: true
};
exports.own = void 0;
var _leaf = require("./leaf.cjs");
Object.keys(_leaf).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _leaf[key];
    }
  });
});
exports.own = "own";
