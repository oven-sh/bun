const parse = require("./lib-function.cjs");
function once(text) { return parse(text); }
let sum = 0;
for (let i = 0; i < 300; i++) sum += once("x".repeat(i % 5));
console.log(sum, once("abc"), parse.name);
