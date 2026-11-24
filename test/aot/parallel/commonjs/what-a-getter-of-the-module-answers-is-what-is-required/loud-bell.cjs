"use strict";
exports.early = "stored before";
let rings = 0;
const answers = { ring: () => ++rings, get rings() { return rings; } };
Object.defineProperty(module, "exports", { configurable: true, get() { return answers; } });
answers.late = "stored behind";
