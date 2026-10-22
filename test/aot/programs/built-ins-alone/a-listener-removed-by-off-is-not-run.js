import { EventEmitter } from "node:events";
let state = "quiet";
function listener() {
  state = 0.5;
}
const emitter = new EventEmitter();
emitter.on("ready", listener);
emitter.off("ready", listener);
console.log(emitter.emit("ready"), typeof state, state.length);
