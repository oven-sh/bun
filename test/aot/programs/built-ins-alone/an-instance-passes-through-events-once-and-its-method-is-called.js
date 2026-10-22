import { EventEmitter, once } from "node:events";
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const emitter = new EventEmitter();
const waiting = once(emitter, "ready");
emitter.emit("ready", new Item(1.5));
console.log((await waiting)[0].double());
