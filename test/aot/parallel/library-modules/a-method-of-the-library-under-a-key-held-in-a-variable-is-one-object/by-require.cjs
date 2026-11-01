// Alone: what the build proves about the class depends on what else the executable reads of it
const { Interface } = require("node:readline/promises");
function get() {
  return Interface.prototype[Symbol.asyncIterator];
}
console.log(get() === Reflect.get(Interface.prototype, Symbol.asyncIterator), get().name);
