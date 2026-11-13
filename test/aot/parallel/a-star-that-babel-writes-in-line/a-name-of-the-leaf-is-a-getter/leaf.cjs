"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = add;
exports.two = void 0;
function add(a, b) { return a + b | 0; }
const two = exports.two = 2;
let now = 1;
Object.defineProperty(exports, "now", { enumerable: true, get: function () { return now; } });
exports.bump = function () { now++; };
