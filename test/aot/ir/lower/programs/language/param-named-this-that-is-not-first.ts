// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS2680 4

// @ts-nocheck
// A parameter named this that is not the first.
function second(x, this) {}
function between(x, this: any, y) {
  return [x, y];
}
class Holder {
  method(x, this) {}
}
const expression = function (x, this) {};
console.log(second.length, between.length, Holder.prototype.method.length, expression.length);
