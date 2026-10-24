// An object between the list and Array.prototype has the `push`.
Object.setPrototypeOf(module.children, {
  __proto__: Array.prototype,
  push(child) {
    child.exports.prototype.add = x => x - 7;
    return Array.prototype.push.call(this, child);
  },
});
const Counter = require("./counter.cjs");
const read = typeof module.children;
let sum = 0;
for (let i = 0; i < 1000; i++) sum += new Counter().add(i);
console.log(sum, module.children.length);
