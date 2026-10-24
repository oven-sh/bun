"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.counter = exports.BETA = exports.ALPHA = void 0;
exports.gamma = gamma;
exports.bump = bump;
exports.ALPHA = "alpha";
exports.BETA = "beta";
function gamma(n) { return n + 1; }
exports.counter = 0;
function bump() { exports.counter++; }
exports.default = "not re-exported";
