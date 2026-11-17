// RUN: link
// OPTIONS: builtin-modules
// CHECK-NOT: runtimefunction id=StdioGetLightStdioWriteStreams

// The `this` of a strict function that is called without a receiver is undefined.

// FILE: main.cjs
"use strict";
module.exports = (function () {
  return this;
})();
