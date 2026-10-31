// Alone: what the build proves about the class depends on what else the executable reads of it
import { Interface } from "node:readline";
function get() {
  return Interface.prototype[Symbol.asyncIterator];
}
function other() {
  return Interface.prototype[Symbol.dispose];
}
console.log(get() === Reflect.get(Interface.prototype, Symbol.asyncIterator), get().name);
console.log(other() === Reflect.get(Interface.prototype, Symbol.dispose), other().name);
