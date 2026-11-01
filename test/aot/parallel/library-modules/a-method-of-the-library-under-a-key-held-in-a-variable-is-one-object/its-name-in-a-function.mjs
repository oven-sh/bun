// Alone: what the build proves about the class depends on what else the executable reads of it
import { Interface } from "node:readline/promises";
function name() {
  return Interface.prototype[Symbol.asyncIterator].name;
}
console.log(name());
