import { EventEmitter } from "node:events";
class Odd extends EventEmitter {
  _events = function () {};
}
console.log(new Odd().rawListeners("constructor")[0]("return 6 * 7")());
