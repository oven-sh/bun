"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function shift(a, b) { return (a + b) | 0; }
function scale(a, b) { return Math.imul(a, b); }
const tools = { shift, scale };
exports.default = tools;
Object.defineProperty(exports, "helper", { enumerable: true, get: function () { return tools; } });
