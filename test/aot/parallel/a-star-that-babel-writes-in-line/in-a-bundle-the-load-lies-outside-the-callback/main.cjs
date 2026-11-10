"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var require_leaf = __commonJS({ "leaf.js"(exports) { Object.defineProperty(exports, "__esModule", { value: true }); exports.two = 2; } });
var require_barrel = __commonJS({ "barrel.js"(exports) {
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
} });
let said;
try { said = String(Object.keys(require_barrel()).length); } catch (error) { said = error.constructor.name; }
var _leaf = require_leaf();
console.log(said);
