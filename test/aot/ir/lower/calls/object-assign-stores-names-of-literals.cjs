// Object.assign(target, { a, b: 1 }) stores the values under their names. The literal is made where the target is no object alone.
// RUN: lower
// OPTIONS: builtin-modules
// CHECK: PropSet {{*}} key="first" calledBuiltin=ObjectAssign @
// CHECK: PropSet {{*}} key="second" calledBuiltin=ObjectAssign @
"use strict";
function fill(target, first) {
  return Object.assign(target, { first, second: 1 });
}
console.log(fill({}, 2).second);
