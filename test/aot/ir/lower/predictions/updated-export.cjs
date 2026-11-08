// The module keeps its object. Nothing is written of the member, so an update converts neither what it reads nor what it stores.
// RUN: link
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: [[read]] = PropGet {{*}}key="count"
// CHECK-NEXT: [[new]] = Increment [[read]]
// CHECK-NEXT: PropSet {{*}}, [[new]] key="count"

// FILE: main.cjs
const counter = require("./counter.cjs");
counter.bump();
console.log(counter.count);

// FILE: counter.cjs
exports.count = 0;
exports.bump = function bump() {
  exports.count++;
};
