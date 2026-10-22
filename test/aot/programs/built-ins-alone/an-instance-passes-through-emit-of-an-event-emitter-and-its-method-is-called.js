import { EventEmitter } from "node:events";
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const emitter = new EventEmitter();
emitter.on("ready", value => console.log(value.double()));
emitter.emit("ready", new Item(1.5));
