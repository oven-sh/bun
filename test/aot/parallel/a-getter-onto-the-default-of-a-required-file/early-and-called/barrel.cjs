"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.early = attempt();
var add_1 = require("./add.cjs");
exports.late = attempt();
function attempt() { try { return "gave " + (0, __importDefault(add_1).default)(1, 2); } catch (error) { return error.constructor.name; } }
