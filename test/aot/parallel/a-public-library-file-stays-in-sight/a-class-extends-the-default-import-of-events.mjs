// STATISTIC: ImageFunctionsEmitted <= 600
import EventEmitter from "node:events";
class A extends EventEmitter { go() { this.emit("x", 1); } }
const e = new A(); e.on("x", v => console.log(v, e instanceof EventEmitter, e.listenerCount("x"))); e.go();
