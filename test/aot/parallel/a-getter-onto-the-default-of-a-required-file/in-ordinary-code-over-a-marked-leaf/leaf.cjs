"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = add;
function add(a, b) { return a + b | 0; }
exports.who = function (a, b) { return (this === exports) + ":" + (a + b); };
