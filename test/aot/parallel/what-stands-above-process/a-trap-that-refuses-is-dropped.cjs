// A proxy above `process` refuses the new link: node:events loads all the same and `process` keeps its chain.
const native = Object.getPrototypeOf(process);
let refused = 0;
Object.setPrototypeOf(process, new Proxy(Object.create(native), {
  setPrototypeOf() { refused++; return false; },
}));
const EventEmitter = require("node:events");
console.log(typeof EventEmitter, refused, Object.getPrototypeOf(native) === Object.prototype);
