"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function plus(a, b) { return (a + b) | 0; }
function times(a, b) { return Math.imul(a, b); }
const tools = { plus, times };
const others = { plus(a, b) { return 1; }, times(a, b) { return 2; } };
exports.default = tools;
let count = 0;
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return count++ % 3 ? tools : others; } });
