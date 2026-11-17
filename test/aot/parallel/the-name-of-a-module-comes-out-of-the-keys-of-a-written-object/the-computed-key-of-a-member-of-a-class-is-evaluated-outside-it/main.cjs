const n = Number(process.argv[2] || 50);
const two = require("./two.cjs");
let sum = 0;
for (let i = 0; i < n; i++) sum += two.twice(i);
const table = (exports.table = { a: "./one.cjs" });
class A { [(this.table.a = "./two.cjs", "k")]() { return 1; } }
sum += new A().k();
let said;
try {
  const found = require(table.a);
  said = found.name + " " + found.twice("ab");
} catch (error) {
  said = "threw " + error.code;
}
console.log("SAID", sum, said);
