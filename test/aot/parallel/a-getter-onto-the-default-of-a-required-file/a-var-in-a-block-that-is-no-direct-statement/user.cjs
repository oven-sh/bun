"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
if (process.argv.length > 9) { var leaf_1 = require("./leaf.cjs"); }
function read() { return __importDefault(leaf_1).default; }
function other() { return __importDefault(leaf_1).other; }
exports.read = read;
exports.other = other;
