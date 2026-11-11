const above = require("./above.cjs");
const kept = require("./kept.cjs");
function own() {}
function run(made, text) { return made.constructor(text)(); }
console.log(typeof process.mainModule, above.four, kept.three);
console.log(run(own, "const list = process.mainModule.children; return [list.length, typeof list[1].parent, list[1].parent === list[0], list[1].exports.three, list[1].children.length, list[1].id.split('/').pop()].join(' ');"));
