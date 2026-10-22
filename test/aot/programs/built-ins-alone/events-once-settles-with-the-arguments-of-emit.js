import { EventEmitter, once } from "node:events";
const emitter = new EventEmitter();
const waiting = once(emitter, "ready");
emitter.emit("ready", 1.5, "two");
const passed = await waiting;
console.log(passed.length, passed[0] + 1, passed[1].length);
