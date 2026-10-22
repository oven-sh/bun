import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
function target() {
  console.log(typeof this, this === emitter);
}
emitter.on("ready", target);
emitter.emit("ready");
