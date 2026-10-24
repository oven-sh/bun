// A required module takes the module object of its parent and of the entry point and changes what they export.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
exports.byParent = 1;
exports.byMain = 1;
exports.byProcess = 1;
exports.f = function (x) { return typeof x; };
const log = require("./child.cjs");
show("1", typeof exports.byParent, typeof exports.byMain, typeof exports.byProcess, log.join());
