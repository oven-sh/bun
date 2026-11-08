"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.change = exports.default = exports.two = exports.one = void 0;
exports.one = "one of marked";
exports.two = 2;
exports.default = "default of marked";
Object.defineProperty(exports, "hidden", { value: "hidden of marked", enumerable: false, writable: true, configurable: true });
exports.change = function () { exports.one = "one of marked, stored later"; exports.late = "late of marked"; return exports; };
