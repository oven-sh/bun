// What stands in the list's place gets each file that is required from then on, and changes a method of the class that the file exports.
const seen = [];
module.children = {
  indexOf() {
    return -1;
  },
  push(child) {
    seen.push(typeof child.exports);
    child.exports.prototype.add = function (x) {
      return -x;
    };
  },
};
const Counter = require("./counter.cjs");
const read = typeof module.children;
let sum = 0;
for (let i = 0; i < 1000; i++) sum += new Counter().add(i);
console.log(sum, seen.join());
