"use strict";
let n = 0;
function f() {
  return n++;
}
module.exports = { f, kState: Symbol("state") };
