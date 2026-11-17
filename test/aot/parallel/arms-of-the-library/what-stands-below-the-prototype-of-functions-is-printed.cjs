const { inspect } = require("node:util");
class Callable extends Function {}
console.log(
  inspect(function named() {}),
  inspect(Object.create(Function.prototype)),
  inspect(new Callable()),
  inspect(Object.create(null)),
  inspect(Object.create({})),
);
