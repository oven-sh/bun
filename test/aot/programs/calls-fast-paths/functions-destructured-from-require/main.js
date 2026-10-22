// `const { add } = require("./tools")`: the variable holds what the export holds: a closure of the one function that is stored there, or of one of two, or nothing yet. No general call is kept.
// IR= 0 ofOneFunction boolean = IsClosureOf
// IR= 1 ofOneFunction TypeTest v[0-9]+ testedType=undefined\|null
// IR= 0 ofOneFunction = Call v[0-9]+, (-|v[0-9]+) \(v
// IR= 0 underAnotherName = Call v[0-9]+, (-|v[0-9]+) \(v
// IR= 0 ofTwoFunctions = Call v[0-9]+, (-|v[0-9]+) \(v
// IR= 1 ofThreeFunctions = Call v[0-9]+, (-|v[0-9]+) \(v
// IR= 1 ofTheHost = Call v[0-9]+, (-|v[0-9]+) \(v
const { add, double: twice, either, oneOfThree, largest } = require("./files/tools.js");

function ofOneFunction(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += add(i, 1);
  return total;
}

function underAnotherName(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += twice(i);
  return total;
}

function ofTwoFunctions(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += either(i);
  return total;
}

function ofThreeFunctions(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += oneOfThree(i);
  return total;
}

function ofTheHost(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += largest(i, 2);
  return total;
}

const held = [ofOneFunction, underAnotherName, ofTwoFunctions, ofThreeFunctions, ofTheHost];
console.log(held.map(f => f(5)).join());
