// An emitter that captures rejections calls the `emit` of its class and of EventEmitter.prototype, and has no `emit` of its own.
import { EventEmitter } from "node:events";

process.on("unhandledRejection", error => console.log("unhandled", error.message));
const turn = () => new Promise(resolve => setImmediate(resolve));

class Sub extends EventEmitter {
  emit(type, ...args) {
    console.log("override called: " + String(type));
    return super.emit(type, ...args);
  }
}
const a = new Sub();
a.on("x", () => {});
a.emit("x");
console.log("--- captureRejections: true");
const b = new Sub({ captureRejections: true });
b.on("error", error => console.log("captured", error.message));
b.on("x", async value => {
  throw new Error("x " + value);
});
b.emit("x", 1);
await turn();

const constructedByNobody = Object.create(EventEmitter.prototype);
constructedByNobody.on("error", error => console.log("captured", error.message));
constructedByNobody.on("x", () => Promise.reject(new Error("while the default is off")));
constructedByNobody.emit("x");
await turn();

console.log("--- EventEmitter.captureRejections = true");
EventEmitter.captureRejections = true;
const c = new Sub();
c.on("x", () => {});
c.emit("x");
console.log("own emit:", Object.hasOwn(b, "emit"), Object.hasOwn(c, "emit"));
console.log(JSON.stringify(Object.keys(b)));
constructedByNobody.on("y", () => Promise.reject(new Error("while the default is on")));
constructedByNobody.emit("y");
await turn();

console.log("--- EventEmitter.prototype.emit replaced");
const original = EventEmitter.prototype.emit;
const before = new EventEmitter();
EventEmitter.prototype.emit = function emit(type, ...args) {
  console.log("replacement called: " + String(type));
  return original.call(this, type, ...args);
};
const after = new EventEmitter();
before.on("before", () => {});
after.on("after", () => {});
before.emit("before");
after.emit("after");
EventEmitter.prototype.emit = original;

console.log("--- the constructor run a second time");
EventEmitter.captureRejections = false;
const twice = new EventEmitter({ captureRejections: true });
EventEmitter.call(twice);
twice.on("error", error => console.log("captured", error.message));
twice.on("x", () => Promise.reject(new Error("after the second run")));
twice.emit("x");
await turn();
console.log(JSON.stringify(Object.keys(twice)));
