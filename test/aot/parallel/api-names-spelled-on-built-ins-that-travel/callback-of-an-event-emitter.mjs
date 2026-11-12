import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.on("api", b => console.log(b.escapeHTML("<a>")));
emitter.emit("api", Bun);
