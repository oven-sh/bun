// The link of an ES file that a CommonJS entry requires lays EventEmitter.prototype above the prototype of process, for an import of node:zlib that nothing has read.
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype ? "Object.prototype" : "another object";
console.log("before:", above());
const late = require("./late.mjs");
console.log("behind the require():", above());
console.log(late.read(), above());
