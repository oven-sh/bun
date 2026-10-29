// What stands in the place of the list gets each file at the moment it is required, not at the next read of `module.children`: the method is changed before the first call.
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
let sum = 0;
for (let i = 0; i < 1000; i++) sum += new Counter().add(i);
console.log(sum, seen.join());
