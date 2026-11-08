"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scale = exports.add = exports.LIMIT = void 0;
exports.LIMIT = 7;
function add(a, b) { return a + b; }
exports.add = add;
function scale(v) { return add(v, v) * exports.LIMIT; }
exports.scale = scale;
