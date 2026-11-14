"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sub = exports.add = void 0;
let calls = 0;
exports.add = function (a, b) { calls++; return a + b; };
exports.sub = function (a, b) { return a - b; };
exports.calls = function () { return calls; };
exports.default = function () { return "default"; };
