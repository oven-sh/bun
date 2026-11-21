// node:zlib is loaded at the link, before any body of the graph: a file in front of the one that imports node:zlib finds EventEmitter.prototype above the prototype of process.
import "./first.mjs";
import { kind } from "./below.mjs";
const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
console.log("the entry:", above === Object.prototype ? "Object.prototype" : "another object", kind);
