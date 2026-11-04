// `Reflect.construct(Object.getPrototypeOf(B), [], B)`: the function above is read at run time and constructed directly: no look by name in the loop.
"use strict";

function A() {
  this.z = 1;
}
A.prototype.base = function () {
  return this.z;
};
function B(a) {
  var self = Reflect.construct(Object.getPrototypeOf(B), [], B);
  self.a = a;
  return self;
}
B.prototype = Object.create(A.prototype);
B.prototype.constructor = B;
Object.setPrototypeOf(B, A);
function turn(i) {
  var v = new B(i);
  return v.a + v.base();
}
function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += turn(i & 7);
  return sum;
}
console.log(bench(1000));
