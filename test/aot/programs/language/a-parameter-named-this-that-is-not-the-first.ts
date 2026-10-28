// @ts-nocheck
function second(x, this) {}
function between(x, this: any, y) {
  return [x, y];
}
class Holder {
  method(x, this) {}
}
const expression = function (x, this) {};
console.log(second.length, between.length, Holder.prototype.method.length, expression.length);
