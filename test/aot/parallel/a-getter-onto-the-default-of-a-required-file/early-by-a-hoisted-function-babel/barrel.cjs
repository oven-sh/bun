"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
exports.early = typeof peek();
var _add = require("./add.cjs");
exports.late = typeof peek();
function peek() { return _interopRequireDefault(_add).default; }
