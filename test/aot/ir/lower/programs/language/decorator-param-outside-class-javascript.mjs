// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1206 4

// A decorator stands on a parameter of a function, of a function expression and of a method and a setter of an object literal. `bun run` reports a syntax error.
function declared(@mark a) {}
const expression = function (@mark() a) {};
const literal = {
  method(@mark a) {},
  set value(@mark a) {},
};
function mark() {}
console.log(typeof declared, typeof expression, typeof literal);
