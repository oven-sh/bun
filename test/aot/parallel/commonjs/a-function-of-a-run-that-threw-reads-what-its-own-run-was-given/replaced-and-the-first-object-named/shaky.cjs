"use strict";
const run = ++globalThis.runs;
exports.run = run;
module.exports = { run: run * 10 };
globalThis.readers.push(function read() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return exports.run + module.exports.run + work - 1; });
if (run === 1) throw new Error("first run");
