// An event that is dispatched on the global object has it as its target, and process is a member of it.
"use strict";
const lib = require("./lib.cjs");
let held;
addEventListener("zz", event => { held = event.target; });
dispatchEvent(new Event("zz"));
const { mainModule } = held.process;
console.log(lib.helper(3), typeof mainModule, mainModule.children.length);
for (const child of mainModule.children) child.exports.helper = () => 99;
console.log(lib.helper(3));
