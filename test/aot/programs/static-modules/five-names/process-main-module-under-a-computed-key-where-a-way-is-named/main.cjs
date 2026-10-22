// The program asks for `module.parent`, so the ways between module objects are shown. process.mainModule starts in the global scope: here it is found under a key that the compiler cannot follow,
// and what the entry point and the file that it requires export is read, stored to and called through it.
const helper = require("./helper.cjs");
let calls = 0;
exports.limit = 5;
exports.bump = n => (calls += n);
function read() {
  let sum = 0;
  for (let round = 0; round < 100; round++) sum += exports.limit + helper.step();
  return sum;
}
console.log("required by somebody:", Boolean(module.parent));
const found = process[["main", "Module"].join("")];
console.log(found === module, read());
found.exports.limit = 7;
console.log(read(), found.exports.bump(3), calls);
found.children[0].exports.step = () => 100;
console.log(read(), helper.step());
