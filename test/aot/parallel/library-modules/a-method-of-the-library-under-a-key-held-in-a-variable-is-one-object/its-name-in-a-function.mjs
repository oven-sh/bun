import { Interface } from "node:readline/promises";
function name() {
  return Interface.prototype[Symbol.asyncIterator].name;
}
console.log(name());
