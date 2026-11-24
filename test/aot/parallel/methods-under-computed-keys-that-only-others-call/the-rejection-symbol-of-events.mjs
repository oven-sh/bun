import { EventEmitter } from "node:events";
class E extends EventEmitter { constructor() { super({ captureRejections: true }); } [Symbol.for("nodejs.rejection")](error, event) { console.log("caught", error.message, event); } }
const e = new E(); e.on("x", async () => { throw new Error("made up"); }); e.emit("x"); await new Promise(r => setTimeout(r, 10)); console.log("end");
