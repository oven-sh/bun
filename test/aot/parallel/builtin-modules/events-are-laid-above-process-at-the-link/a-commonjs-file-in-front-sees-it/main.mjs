// node:zlib is loaded at the link, before any body of the graph: a CommonJS file that the entry imports in front of node:zlib finds EventEmitter.prototype above the prototype of process.
import "./first.cjs";
import zlib from "node:zlib";
const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
console.log("the entry:", above === Object.prototype ? "Object.prototype" : "another object");
