import EventEmitter, { once, getEventListeners } from "node:events";
class A extends EventEmitter {}
const e = new A(); const f = () => {}; e.on("x", f); console.log(getEventListeners(e, "x").length, getEventListeners(e, "x")[0] === f);
setTimeout(() => e.emit("y", 7), 1); console.log((await once(e, "y"))[0]); console.log(structuredClone({ a: 1 }).a, JSON.stringify(e).length > 0);
