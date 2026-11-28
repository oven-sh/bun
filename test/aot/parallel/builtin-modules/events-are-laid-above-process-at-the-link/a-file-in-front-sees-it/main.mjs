// node:zlib is loaded at the link, before any body of the graph: the body of a file that the entry imports in front of node:zlib finds EventEmitter.prototype above the prototype of process.
import "./first.mjs";
import zlib from "node:zlib";
const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
console.log("the entry:", above === Object.prototype ? "Object.prototype" : "another object");
