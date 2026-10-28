// @ts-nocheck
function first(this, x) {}
function alone(this: any) {
  return this;
}
class Holder {
  method(this: Holder, x, y) {
    return [this instanceof Holder, x, y];
  }
}
const expression = function (this, x) {};
console.log(first.length, alone.length, Holder.prototype.method.length, expression.length);
console.log(alone.call(7), new Holder().method(1, 2));
console.log(String(first));
