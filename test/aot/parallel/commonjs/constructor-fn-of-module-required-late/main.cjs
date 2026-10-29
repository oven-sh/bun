// Constructor function of a module required late.
// Reference: bun build --compile
"use strict";
// The module is required inside a function, so nothing proves that its body runs once: after its eviction it runs again, and each evaluation has functions and prototype objects of its own.
let loaded;
function library() {
  return loaded || (loaded = require("./parameters.cjs"));
}
function check(title, made) {
  let text = "";
  for (let round = 0; round < 200; round++) {
    const { parameters, pairs } = made.parse("charset=utf-" + (round & 7) + ";q=" + round);
    text = [
      pairs,
      parameters.charset.describe(),
      parameters.q.describe(),
      Object.getPrototypeOf(parameters) === made.NullObject.prototype,
      Object.getPrototypeOf(Object.getPrototypeOf(parameters)),
      parameters instanceof made.NullObject,
      parameters.q instanceof made.Pair,
      Object.getPrototypeOf(parameters.q) === made.Pair.prototype,
      "toString" in parameters,
    ].join(" ");
  }
  console.log(title + ": " + text);
}
const first = library();
check("first", first);

delete require.cache[require.resolve("./parameters.cjs")];
loaded = undefined;
const second = library();
console.log("evaluated again:", second !== first, second.NullObject !== first.NullObject, second.NullObject.prototype !== first.NullObject.prototype, second.Pair.prototype !== first.Pair.prototype);
check("second", second);
check("first again", first);
console.log("across:", first.parse("a=1").parameters instanceof second.NullObject, second.parse("a=1").parameters.a instanceof first.Pair);

first.NullObject.prototype = { marked: true };
first.Pair.prototype = { describe() { return "replaced"; } };
check("first with other prototypes", first);
check("second untouched", second);
console.log(first.parse("a=1").parameters.marked, second.parse("a=1").parameters.marked);
