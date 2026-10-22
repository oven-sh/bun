"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
Object.defineProperty(exports, "__esModule", { value: true });
exports.late = exports.counter = exports.add = exports.K = void 0;
exports.K = 7;
function add(a, b) { return a + b; }
exports.add = add;
exports.counter = 0;
function bump() { exports.counter++; return exports.counter; }
exports.bump = bump;
exports.arrow = (x) => x * 2;
exports["quoted"] = "q";
module.exports.viaModule = "m";
exports.setLate = function (v) { exports.late = v; };
exports.callsOwn = function () { return exports.add(10, 20) + exports.arrow(1); };
exports.Point = class Point { constructor(x) { this.x = x; } };
exports.tag = (strings, v) => strings[0] + v;
if (exports.K > 5) exports.conditional = "yes";
exports.compound = 1; exports.compound += 4; exports.compound ||= 9; exports.nil ??= "filled";
[exports.fromArray, exports.second] = [1, 2];
({ a: exports.fromObject } = { a: "o" });
exports.helper = typeof __importDefault;
