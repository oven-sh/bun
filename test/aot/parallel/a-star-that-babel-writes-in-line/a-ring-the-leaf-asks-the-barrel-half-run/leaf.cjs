"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = add;
function add(a, b) { return a + b | 0; }
const back = require("./barrel.cjs");
console.log("in the ring", typeof back.add, Object.keys(back).length);
exports.two = 2;
