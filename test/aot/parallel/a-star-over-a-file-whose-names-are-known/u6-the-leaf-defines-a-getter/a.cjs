"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let asked = 0; Object.defineProperty(exports, "add", { enumerable: true, get() { asked++; return asked % 2 ? plus : minus; } }); exports.asked = () => asked; function plus(a, b) { return a + b; } function minus(a, b) { return a - b; }
