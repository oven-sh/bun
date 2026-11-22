"use strict";
function one(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "one" + n; }
function two(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "two" + n; }
module.exports = { get written() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return one; } };
Object.defineProperty(module.exports, "laid", { enumerable: true, get: function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return two; } });
