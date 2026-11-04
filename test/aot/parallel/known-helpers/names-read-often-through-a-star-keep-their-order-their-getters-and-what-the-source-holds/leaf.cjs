"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.change = exports.own = exports.two = exports.add = void 0;
exports.add = function (a, b) { return a + b; };
exports.two = 2;
exports.own = "of the leaf";
exports.change = function () { exports.two = 30; exports.add = function (a, b) { return a * b; }; };
exports.default = { add: 1 };
