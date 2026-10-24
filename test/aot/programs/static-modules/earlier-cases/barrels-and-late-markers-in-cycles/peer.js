"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
const latemark_1 = __importDefault(require("./latemark"));
exports.saw = typeof latemark_1.default;
exports.later = function () { return typeof latemark_1.default + ":" + String(latemark_1.default.default); };
