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
emitter.on("ready", () => {
  throw new Item(1.5);
});
try {
  emitter.emit("ready");
} catch (error) {
  console.log(error.double());
}
