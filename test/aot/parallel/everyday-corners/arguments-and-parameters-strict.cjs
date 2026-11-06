"use strict";
// Arguments and parameters strict: compiled answers as plain.
function f(a, b) {
  arguments[0] = "changed";
  b = "set";
  return [a, arguments[1], arguments.length].join();
}
console.log(f(1, 2), f(1), f());
