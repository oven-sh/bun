// The list itself stays, and a function of the program stands under `indexOf` on it.
module.children.indexOf = function (child) {
  child.exports.prototype.add = function (x) {
    return x * 3;
  };
  return Array.prototype.indexOf.call(this, child);
};
const Counter = require("./counter.cjs");
const read = typeof module.children;
let sum = 0;
for (let i = 0; i < 1000; i++) sum += new Counter().add(i);
console.log(sum, module.children.length);
