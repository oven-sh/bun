// child.cjs is required under a name that the compiler cannot follow, and changes what this file exports through `module.parent`. This file does the same to child.cjs through `module.children`.
const nameOfChild = ["./chi", "ld.cjs"].join("");
let calls = 0;
exports.limit = 5;
exports.bump = n => (calls += n);
function read() {
  let sum = 0;
  for (let round = 0; round < 100; round++) sum += exports.limit;
  return sum;
}
console.log(read(), calls);
const child = require(nameOfChild);
console.log(read(), calls, child.read());
module.children[0].exports.step = 9;
module.children[0].exports.note("from the parent");
console.log(child.read(), child.notes());
