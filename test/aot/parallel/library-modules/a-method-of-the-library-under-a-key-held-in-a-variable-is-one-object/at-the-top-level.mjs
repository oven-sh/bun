import { Interface } from "node:readline/promises";
console.log(
  Interface.prototype[Symbol.asyncIterator] === Reflect.get(Interface.prototype, Symbol.asyncIterator),
  Interface.prototype[Symbol.asyncIterator].name,
);
