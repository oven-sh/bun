"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let now = function (a, b) { return a + b | 0; };
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return now; } });
exports.swap = function () { now = function (a, b) { return a * 2 - b | 0; }; };
