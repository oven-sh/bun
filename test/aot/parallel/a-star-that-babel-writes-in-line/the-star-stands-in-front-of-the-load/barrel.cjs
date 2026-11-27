"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
var _leaf = require("./leaf.cjs");
