// A function that replaces a method of process, by its name or under a computed key, gets process where the method is called.
"use strict";
const lib = require("./lib.cjs");
const held = [];
const { cwd, emitWarning } = process;
process.cwd = function () { held.push(this); return cwd(); };
replace(process, "emitWarning");
function replace(p, name) { p[name] = function () { held.push(this); }; }
process.cwd();
process.emitWarning("never printed");
process.cwd = cwd;
process.emitWarning = emitWarning;
const { mainModule } = held[1];
console.log(lib.helper(3), held.length, held[0] === held[1], typeof mainModule, mainModule.children.length);
for (const child of mainModule.children) child.exports.helper = () => 99;
console.log(lib.helper(3));
