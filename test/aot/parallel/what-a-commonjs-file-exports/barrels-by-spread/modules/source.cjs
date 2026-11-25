"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Shape = exports.mix = exports.over = void 0;
class Shape { constructor(kind, size) { this.kind = kind; this.size = size; } area() { return this.size * this.size; } }
function mix(a, b) { return (a * 31 + b) | 0; }
exports.Shape = Shape; exports.mix = mix; exports.over = "source"; exports.count = 0;
exports.bump = () => ++exports.count;
