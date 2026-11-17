"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Figure = exports.scale = void 0;
class Figure { constructor(kind, size) { this.kind = kind; this.size = size; } area() { return this.size * this.size; } }
function scale(a, b) { return (a * 31 + b) | 0; }
let steps = 0;
exports.Figure = Figure; exports.scale = scale; exports.steps = 0;
exports.step = () => { exports.steps = ++steps; return steps; };
