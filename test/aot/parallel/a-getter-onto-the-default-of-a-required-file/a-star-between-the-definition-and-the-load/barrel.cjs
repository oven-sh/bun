"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "add", { enumerable: true, get: function () { return _add.default; } });
var _rest = require("./rest.cjs");
Object.keys(_rest).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _rest[key]) return;
  Object.defineProperty(exports, key, { enumerable: true, get: function () { return _rest[key]; } });
});
var _add = _interopRequireDefault(require("./leaf.cjs"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
