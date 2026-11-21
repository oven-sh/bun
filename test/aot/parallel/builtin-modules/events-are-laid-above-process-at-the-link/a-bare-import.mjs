// An import of node:zlib without a binding loads the module at the link: EventEmitter.prototype lies above the prototype of process.
import "node:zlib";
const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
console.log(above === Object.prototype ? "Object.prototype" : "another object");
