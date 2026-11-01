// Alone: what the build proves about the class depends on what else the executable reads of it
import { Interface } from "node:readline/promises";
class Asks {
  held = Interface.prototype[Symbol.asyncIterator];
}
console.log(new Asks().held === Reflect.get(Interface.prototype, Symbol.asyncIterator), new Asks().held.name);
