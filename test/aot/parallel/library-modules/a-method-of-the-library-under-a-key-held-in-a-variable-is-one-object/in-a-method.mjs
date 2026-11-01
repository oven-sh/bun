// Alone: what the build proves about the class depends on what else the executable reads of it
import { Interface } from "node:readline/promises";
class Asks {
  get() {
    return Interface.prototype[Symbol.asyncIterator];
  }
}
console.log(new Asks().get() === Reflect.get(Interface.prototype, Symbol.asyncIterator), new Asks().get().name);
