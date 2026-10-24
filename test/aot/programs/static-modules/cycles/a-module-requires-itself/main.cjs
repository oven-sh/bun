// A CommonJS module that requires itself, at the top and in a function: the body does not start again, and the answer is its own exports as far as they have got. Once by names, once as an object.
const names = require("./names.cjs"),
  object = require("./object.cjs");
console.log(names.sawBefore, names.sawAfter, names.inFunction(), names.readBack);
console.log(object.same, object.keys, Object.keys(object).join());
