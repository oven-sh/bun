"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.next = exports.count = void 0;
let count = 0;
exports.count = count;
function next() { exports.count = count = count + 1; return count; }
exports.next = next;
