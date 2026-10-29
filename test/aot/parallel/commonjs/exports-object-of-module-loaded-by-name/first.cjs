"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.name = exports.same = void 0;
exports.name = "first";
exports.same = this === exports && module.exports === exports;
exports.read = () => exports.name;
exports.partner = require("./second.cjs");
