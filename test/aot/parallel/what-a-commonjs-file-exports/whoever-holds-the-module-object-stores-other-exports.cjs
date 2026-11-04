const first = require("./lib-hands-its-module-out.cjs");
function call() { return require("./lib-hands-its-module-out.cjs")(); }
let out = "";
for (let i = 0; i < 100; i++) out = call();
globalThis.handedOut.exports = function theirs() { return "theirs"; };
for (let i = 0; i < 100; i++) out += call().length;
console.log(out.length, call(), first());
