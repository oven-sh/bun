"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var require_leaf = __commonJS({
  "leaf.js"(exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = 5;
  }
});
var require_barrel = __commonJS({
  "barrel.js"(exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    Object.defineProperty(exports, "add", { enumerable: true, get: function () { return _add.default; } });
  }
});
require_leaf();
var barrel = require_barrel();
let said;
try { said = String(barrel.add); } catch (error) { said = error.constructor.name; }
var _add = _interopRequireDefault(require_leaf());
console.log(said, barrel.add);
