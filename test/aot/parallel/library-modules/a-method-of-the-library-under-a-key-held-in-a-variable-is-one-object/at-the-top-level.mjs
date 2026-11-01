// Alone: what the build proves about the class depends on what else the executable reads of it
import { Interface } from "node:readline/promises";
console.log(
  Interface.prototype[Symbol.asyncIterator] === Reflect.get(Interface.prototype, Symbol.asyncIterator),
  Interface.prototype[Symbol.asyncIterator].name,
);
