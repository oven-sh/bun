"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = add;
exports.two = void 0;
function add(a, b) { return a + b | 0; }
const two = exports.two = 2;
exports.swap = function () { exports.add = function (a, b) { return a - b | 0; }; exports.two = 3; };
