// `var a = require(..)`: ahead of the store the variable holds undefined, and `a.f` throws a TypeError.
function hoisted() {
  return a.f();
}
try {
  hoisted();
} catch (error) {
  console.log(error.constructor.name);
}
var a = require("./a.cjs");
console.log(hoisted());
