"use strict";
const run = ++globalThis.runs;
exports.run = run;
globalThis.readers.push(function read() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return module.exports.run * 10 + exports.run + work - 1; });
if (run < 3) throw new Error("run " + run);
