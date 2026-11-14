"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  own: true
};
exports.own = own;
var _babelLeaf = require("./babel-leaf.cjs");
Object.keys(_babelLeaf).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _babelLeaf[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _babelLeaf[key];
    }
  });
});
function own() { return "own"; }
