// DIAGNOSTIC: TS100093 main.cjs:12
// DIAGNOSTIC: TS100093 main.cjs:13
// DIAGNOSTIC: TS100093 main.cjs:14
// DIAGNOSTIC: TS100093 main.cjs:15
// DIAGNOSTIC: TS100093 main.cjs:17
// RUN: lower
// CHECK-LABEL: function {{*}}name="takesRest"

// FILE: main.cjs
// Whoever is handed a require finds require.cache there. A rest parameter takes every argument from its place on, however many stand in front. An argument behind the last parameter of a
// function without one, which does not read `arguments` either, goes nowhere. The table itself is told wherever it is handed.
function takesRest(first, ...rest) {
  return [first, rest.length];
}
function takesOne(first) {
  return first;
}
class Loader {
  constructor(first, ...rest) {}
}
console.log(takesRest(1, require));
console.log(takesRest(1, 2, require));
console.log(takesRest(1, 2, 3, require));
console.log(new Loader(1, 2, require));
console.log(takesOne(1, require));
console.log(takesOne(1, require.cache));
