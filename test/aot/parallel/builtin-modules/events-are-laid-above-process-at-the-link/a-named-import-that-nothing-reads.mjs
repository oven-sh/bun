// A named import of node:zlib that nothing reads loads the module at the link: EventEmitter.prototype lies above the prototype of process.
import { gzipSync } from "node:zlib";
const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
console.log(above === Object.prototype ? "Object.prototype" : "another object");
