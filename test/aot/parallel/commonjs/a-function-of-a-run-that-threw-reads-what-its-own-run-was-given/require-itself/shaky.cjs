"use strict";
const run = ++globalThis.runs;
exports.run = run;
globalThis.readers.push(function read() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return require; });
if (run === 1) throw new Error("first run");
