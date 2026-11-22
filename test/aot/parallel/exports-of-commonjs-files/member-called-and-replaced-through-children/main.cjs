// the entry calls a member of what a file two levels down exports through module.children, with texts, and replaces it there
// Under: --aot-testing=CheckProofsAtRunTime: what a read of the exports variable finds is held against what Link says of it
"use strict";
const user = require("./user.cjs");
let out = "";
for (let i = 0; i < 4; i++) out += user.use(i) + ";";
const child = module.children[0].children[0];
out += child.exports.sum("t", "x") + ";";
child.exports.sum = function other(a, b) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "other" + a + b; };
for (let i = 0; i < 4; i++) out += user.use(i) + ";";
console.log(out);
