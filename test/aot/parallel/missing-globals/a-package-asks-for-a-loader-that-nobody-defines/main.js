// A package in the form that works under every loader asks first for a loader that Bun does not have: `typeof define === "function" && define.amd`. Nobody defines the name,
// so nothing is handed to it, and what the package exports is called with what the program passes and nothing else: the loop below walks a list of numbers.
// COUNT: arrivals <= 1004
// COUNT: cells <= 6
var helpers = require("helpers");
var list = [1, 2, 3, 4];
function turn(i) {
  var sum = i;
  for (var walk = helpers.values(list), step = walk.next(); !step.done; step = walk.next()) sum += step.value;
  return sum;
}
var total = 0;
for (var i = 0; i < 1000; i++) total += turn(i & 7);
console.log(total, typeof define, typeof globalThis.values, typeof globalThis.other);
