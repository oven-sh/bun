// A using declarator that nobody names stands beside a constant that holds a function nobody calls.
// STATISTIC: FunctionsLowered <= 60
using nothing = null;
const pickLater = function (from, key) { return from[key]; };
console.log(`SAID done`);
