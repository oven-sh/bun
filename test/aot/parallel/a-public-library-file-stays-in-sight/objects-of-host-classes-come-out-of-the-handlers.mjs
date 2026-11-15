import EventEmitter from "node:events";
class A extends EventEmitter {}
const e = new A(); e.on("x", v => console.log(v.constructor.name, v instanceof Object));
for (const v of [new Map(), new URL("http://made.up/"), new Uint8Array(1), new Date(0), /x/, new Error("e"), Promise.resolve(), new Blob([]), Buffer.from("a"), new Headers()]) e.emit("x", v);
