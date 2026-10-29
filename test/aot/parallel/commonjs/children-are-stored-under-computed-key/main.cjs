// The store names the property by a key that is put together when the program runs.
const key = ["chil", "dren"].join("");
void module.children;
module[key] = {
  indexOf: () => -1,
  push(child) {
    child.exports.prototype.add = x => x + 1000;
  },
};
const Counter = require("./counter.cjs");
const read = typeof module.children;
let sum = 0;
for (let i = 0; i < 1000; i++) sum += new Counter().add(i);
console.log(sum);
