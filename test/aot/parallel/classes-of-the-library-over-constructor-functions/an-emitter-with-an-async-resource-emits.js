const { EventEmitterAsyncResource, EventEmitter } = require("node:events");
const emitter = new EventEmitterAsyncResource({ name: "made up" });
emitter.on("told", value => console.log(value, emitter instanceof EventEmitter, emitter.listenerCount("told")));
emitter.emit("told", 1);
console.log(Object.getPrototypeOf(EventEmitterAsyncResource) === EventEmitter, typeof emitter.asyncId, Object.keys(emitter).join());
