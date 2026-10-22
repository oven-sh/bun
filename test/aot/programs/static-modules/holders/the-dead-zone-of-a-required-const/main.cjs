// `const a = require(..)` holds nothing that anybody needs, but the language gives it a dead zone: a hoisted function that reads `a.f` throws a ReferenceError when it is called ahead of the declaration, and works behind it. A function that is made behind the declaration needs no check.
// STATISTIC: ModulesWithNames >= 1
function hoisted() {
  return a.f();
}
try {
  hoisted();
} catch (error) {
  console.log(error.constructor.name);
}
const a = require("./a.cjs");
const later = function () {
  return a.f();
};
console.log(hoisted(), later());
