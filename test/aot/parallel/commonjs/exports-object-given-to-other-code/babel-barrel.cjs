"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  own: true
};
exports.own = void 0;
var _source = require("./source.cjs");
Object.keys(_source).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _source[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _source[key];
    }
  });
});
const own = exports.own = "own";
