"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = void 0;
exports.early = typeof peek();
var add_1 = require("./leaf.cjs");
exports.late = typeof peek();
function peek() { return __importDefault(add_1).default; }
Object.defineProperty(exports, "add", { enumerable: true, get: function () { return __importDefault(add_1).default; } });
Object.defineProperty(exports, "twice", { enumerable: true, get: function () { return __importDefault(add_1).twice; } });
