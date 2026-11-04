// An object handed to a call that only rare ways need whole is not made in the loop.
"use strict";
function check(instance, Constructor) {
  if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function A() {
  check(this, A);
  this.z = 1;
}
A.prototype.base = function () {
  return this.z;
};
function turn(i) {
  var v = new A();
  return v.base() + i;
}

function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += turn(i & 7);
  return sum;
}
console.log(bench(1000));
