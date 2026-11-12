"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var add_1 = require("./leaf.cjs");
exports.sum = function (n) { let s = 0; for (let i = 0; i < n; i++) s = (0, __importDefault(add_1).default)(s, i); return s; };
exports.asMember = function (a, b) { return __importDefault(add_1).who(a, b); };
