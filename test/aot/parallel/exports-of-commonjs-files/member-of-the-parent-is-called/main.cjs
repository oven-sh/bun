// a file calls a member of what its parent exports through module.parent, with texts where every other caller passes integers
// Under: --aot-testing=CheckProofsAtRunTime: what a read of the exports variable finds is held against what Link says of it
"use strict";
const middle = require("./middle.cjs");
let out = "";
for (let i = 0; i < 4; i++) out += middle.scale(i, i) + ";";
out += middle.child.run();
console.log(out);
