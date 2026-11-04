const { Interface } = require("node:readline/promises");
function get() {
  return Interface.prototype[Symbol.asyncIterator];
}
console.log(get() === Reflect.get(Interface.prototype, Symbol.asyncIterator), get().name);
