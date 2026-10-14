// EventEmitter.emit(), compiled as untyped JavaScript.
// @ts-ignore
import EventEmitter from "./untyped.js";
declare const console: any;
const e = new (EventEmitter as any)(); let n = 0; e.on("x", (v: number) => { n += v; });
for (let i = 0; i < 5_000_000; i++) e.emit("x", 1);
console.log(n);
