// Flags: --external outside-package
const outside = require("outside-package");
process._kill = require("node:events");
for (const line of outside.patch()) console.log(line);
console.log("after:", typeof Date.now());
