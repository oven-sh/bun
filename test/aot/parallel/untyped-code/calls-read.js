// A function without written types is called in three places with small integers and in a fourth with a text. Only one call may be read, so nothing is taken from them.
// Flags: --aot-limit=MaxCallsReadForParameter:1
// STATISTIC: MaxCallsReadForParameterHits >= 1
function twice(value) {
  return value + value;
}
let sum = 0;
for (let i = 0; i < 300; i++) sum += twice(i);
console.log(sum, twice(7), twice(2 ** 31), twice("ab"), twice(0.25), String(twice(undefined)));
