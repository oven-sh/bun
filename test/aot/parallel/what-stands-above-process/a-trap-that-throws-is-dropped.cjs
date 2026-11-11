// A proxy above `process` throws when it is asked what stands above it: node:events loads all the same and `process` keeps its chain.
const native = Object.getPrototypeOf(process);
let thrown = 0;
Object.setPrototypeOf(process, new Proxy(Object.create(native), {
  getPrototypeOf() { thrown++; throw new RangeError("madeUp"); },
}));
let EventEmitter;
try { EventEmitter = require("node:events"); console.log("loaded", typeof EventEmitter, thrown); } catch (error) { console.log("threw", error.name); }
console.log(Object.getPrototypeOf(native) === Object.prototype);
