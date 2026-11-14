"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
function pick(flag) {
  if (flag) { var add_1 = require("./add.cjs"); }
  return typeof __importDefault(add_1).default;
}
exports.without = pick(false);
exports.with = pick(true);
