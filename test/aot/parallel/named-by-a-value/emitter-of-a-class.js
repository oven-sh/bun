import { EventEmitter } from "node:events";
class Bell extends EventEmitter { ring() { return this.emit("ring", 1); } }
const bell = new Bell(); bell.on("ring", n => console.log("rang", n)); console.log(bell.ring());
