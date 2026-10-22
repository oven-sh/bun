// One odd line that never runs stands beside a program that does not change: x emitter small. It prints what plain Bun prints.
import { EventEmitter } from "node:events";
const e = new EventEmitter();
e.on("x", (v: number) => console.log(v + 1));
e.emit("x", 1);
