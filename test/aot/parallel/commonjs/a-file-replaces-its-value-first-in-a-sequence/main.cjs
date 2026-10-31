// `module.exports = value, module.exports.__esModule = true, module.exports["default"] = module.exports;`, as every file of @babel/runtime ends: what stands first in the sequence is evaluated first, so nobody sees the object that the file began with, unless the file lies on a cycle or its value is made by a function that looks.
// COUNT: arrivals <= 40
var plain = require("./plain.cjs");
var looks = require("./looks.cjs");
var first = require("./cycle-first.cjs");
function turn(i) {
  return plain(i & 7);
}
var sum = 0;
for (var i = 0; i < 3000; i++) sum += turn(i);
console.log(sum, typeof plain, plain.__esModule, plain["default"] === plain, Object.keys(plain).join());
console.log(looks.seen, looks.marked);
console.log(first.name, first.seenBySecond, first.second.name);
