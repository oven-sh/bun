"use strict";
const run = ++globalThis.runs;
exports.run = run;
class Kept { static first = exports.run; static second = module.exports.run; static third; static { Kept.third = typeof module + typeof require; } field = exports.run; }
globalThis.readers.push(function read() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "" + Kept.first + Kept.second + Kept.third + new Kept().field + (work - 1); });
if (run === 1) throw new Error("first run");
