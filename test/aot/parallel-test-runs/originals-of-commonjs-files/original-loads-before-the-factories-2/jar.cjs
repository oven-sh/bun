(globalThis.log ??= []).push("jar");
exports.box = {};
(globalThis.boxes ??= []).push(exports.box);
exports.word = "real jar";
require("./deep.cjs");
