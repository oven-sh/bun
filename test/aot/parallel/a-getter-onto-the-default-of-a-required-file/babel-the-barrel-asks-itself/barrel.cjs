"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "add", { enumerable: true, get: function () { return _add.default; } });
var _add = _interopRequireDefault(require("./leaf.cjs"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
console.log("own", exports.add(2, 3));
