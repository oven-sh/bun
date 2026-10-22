import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
let state = 0;
function target() {
  state = "changed";
}
emitter.once("ready", target);
emitter.emit("ready");
console.log(typeof state, state.length);
