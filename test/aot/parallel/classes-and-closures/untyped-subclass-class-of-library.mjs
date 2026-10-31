// Untyped class below a class of the library.
import { AsyncResource } from "node:async_hooks";
import { EventEmitter } from "node:events";

class Mine extends AsyncResource {
  extra = 1;
  constructor() {
    super("mine");
  }
}

class Heard extends EventEmitter {
  extra = 1;
  constructor() {
    super();
    this.more = 2;
  }
  total() {
    return this.extra + this.more + this.listenerCount("x");
  }
}

let sum = 0;
for (let i = 0; i < 300; i++) {
  const mine = new Mine();
  sum += typeof mine.triggerAsyncId() === "number" ? mine.extra : 100;
  const heard = new Heard();
  heard.on("x", () => {});
  sum += heard.total();
}
console.log(sum, new Mine() instanceof AsyncResource, new Heard() instanceof EventEmitter, Object.keys(new Mine()).join(), Object.keys(new Heard()).join());
