// bun: + the name of a Node.js module is that module.
console.log(require("bun:crypto") === require("node:crypto"));
