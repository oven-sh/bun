const fs = require("node:fs");
class Patched {}
fs.WriteStream = Patched;
const rest = require("./rest.mjs");
console.log(rest.held() === Patched, typeof rest.all().readFile);
