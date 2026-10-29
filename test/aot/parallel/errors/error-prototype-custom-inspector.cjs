"use strict";
const { inspect } = require("node:util");
function patch(errorConstructor) {
  const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");
  errorConstructor.prototype[inspectSymbol] = function () {
    return "an error that says " + this.message;
  };
}
patch(Error);
console.log(
  inspect(new Error("one")),
  inspect(new TypeError("two")),
  typeof Error.prototype[Symbol.for("nodejs.util.inspect.custom")],
);
