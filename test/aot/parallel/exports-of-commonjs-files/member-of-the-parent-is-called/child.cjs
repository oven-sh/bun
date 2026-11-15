"use strict";
exports.run = function run() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let out = ""; for (let i = 0; i < 3; i++) out += module.parent.exports.scale("p", i) + ";"; return out; };
