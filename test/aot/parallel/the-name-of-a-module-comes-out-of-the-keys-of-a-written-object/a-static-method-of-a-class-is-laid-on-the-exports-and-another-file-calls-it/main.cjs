const n = Number(process.argv[2] || 50);
const two = require("./two.cjs");
let sum = 0;
for (let i = 0; i < n; i++) sum += two.twice(i);
const table = (exports.table = { a: "./one.cjs" });
class Walk { static step() { this.table.a = "./two.cjs"; } }
exports.step = Walk.step;
require("./change.cjs");
let said;
try {
  const found = require(table.a);
  said = found.name + " " + found.twice("ab");
} catch (error) {
  said = "threw " + error.code;
}
console.log("SAID", sum, said);
