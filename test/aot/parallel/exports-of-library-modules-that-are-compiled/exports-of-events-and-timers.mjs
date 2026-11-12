import { EventEmitter, once } from "node:events";
import { setTimeout as later } from "node:timers/promises";
const bell = new EventEmitter();
const heard = once(bell, "ring");
bell.emit("ring", 7);
console.log((await heard)[0], await later(1, "done"), bell.listenerCount("ring"));
