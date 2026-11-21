// A star export over node:zlib loads the module at the link: EventEmitter.prototype lies above the prototype of process.
export * from "node:zlib";
const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
console.log(above === Object.prototype ? "Object.prototype" : "another object");
