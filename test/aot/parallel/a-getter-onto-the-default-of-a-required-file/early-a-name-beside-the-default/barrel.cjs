"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.early = String(peek());
var add_1 = require("./add.cjs");
exports.late = String(peek());
function peek() { return __importDefault(add_1).extra; }
