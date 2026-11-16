// on() returns the emitter that it is called on: what keeps the result keeps process.
"use strict";
const lib = require("./lib.cjs");
const held = process.on("zz", () => {});
const { mainModule } = held;
console.log(lib.helper(3), typeof mainModule, mainModule.children.length);
for (const child of mainModule.children) child.exports.helper = () => 99;
console.log(lib.helper(3));
