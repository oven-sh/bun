"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.report = report;
var _marked = _interopRequireDefault(require("./marked"));
var _unmarked = _interopRequireDefault(require("./unmarked"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function report() { return [(0, _marked.default)(), _unmarked.default.x].join(" "); }
