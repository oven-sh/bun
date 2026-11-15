const part = require("./part.cjs");
function own() {}
function run(made, text) { return made.constructor(text)(); }
void module.children;
console.log(typeof process.mainModule, part.add(1));
console.log(run(own, "const list = process.mainModule.children; list[0].exports.add = function (x) { return x + 100; }; return list.length;"), part.add(1));
