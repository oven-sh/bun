"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function ua(a, b) { return (a + b) | 0; }
function ub(a, b) { return Math.imul(a, b); }
const lib = { ua, ub, version: 3 };
Object.defineProperty(lib, "version", { enumerable: false });
exports.default = lib;
