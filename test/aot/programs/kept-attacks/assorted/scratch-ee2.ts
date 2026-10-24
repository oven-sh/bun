// Assorted, one probe of many. It prints what plain Bun prints.
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.on("e", (value: number) => console.log("got", value));
emitter.emit("e", 1);
