// An emitter calls its listeners with itself as this: a function of another file gets process, and what reads the main module off it sees the modules.
"use strict";
const lib = require("./lib.cjs");
const listeners = require("./listeners.cjs");
process.once("zz", listeners.keep);
process.emit("zz");
const { mainModule } = listeners.kept();
console.log(lib.helper(3), typeof mainModule, mainModule.children.length);
for (const child of mainModule.children) if (child.id.endsWith("lib.cjs")) child.exports.helper = () => 99;
console.log(lib.helper(3));
