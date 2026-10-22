// Untyped programs: a events. It prints what plain Bun prints.
import { EventEmitter } from "node:events";
const e = new EventEmitter();
e.on("x", (v: number) => console.log(v));
e.emit("x", 1);
